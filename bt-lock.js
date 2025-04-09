/****************************************************************************
 * NAME:        bt-lock.js                                                  *
 * DESCRIPTION: Bluetooth JavaScript Library for Kerong Bluetooth Locks     *
 *		like the KR-T153-BT.					    																		*
 * AUTHOR:      Roel Broersma (roel@gigaweb.nl)				    									*
 * GITHUB:      https://github.com/roelbroersma/kerong_BT_lock              *
 * LICENSE:     MIT License						    																	*
 ****************************************************************************/
 
 
 /***************************************************************************
 * BASE CONFIGURATION							    																			*
 * This should be the same for every lock				   													*
 ****************************************************************************/
 export const BASE_CONFIG = {
  NAME_PREFIX:			'SN:',
  SERVICE_UUID:			'0000fff0-0000-1000-8000-00805f9b34fb',
  WRITE_CHAR_UUID:	'0000fff2-0000-1000-8000-00805f9b34fb',
  NOTIFY_CHAR_UUID:	'0000fff1-0000-1000-8000-00805f9b34fb'
};


/***************************************************************************
 * STATE & VARIABLES                                                       *
 ***************************************************************************/
let btDebug			  = true;
let CONFIG			  = {};
let bluetoothDevice;
let writeCharacteristic;
let notifyCharacteristic;
let randomCode;
let userDataBuffer		  = [];
let isAuthenticated		  = false;
let pendingBatteryResolve	  = null;
const pendingCreateUserPassword   = new Map();
const latestPasswords		  = {};


/****************************************************************************
 * BLUETOOTH LOGIC / MAIN FUNCTIONS					    														*
 ****************************************************************************/

/* FUNCTION TO GET THE DEVICE_NAME AFTER INITIAL CONNECT */
export async function connectToDevice() {
  bluetoothDevice = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: BASE_CONFIG.NAME_PREFIX }],
    optionalServices: [BASE_CONFIG.SERVICE_UUID]
  });

  const server = await bluetoothDevice.gatt.connect();
  const service = await server.getPrimaryService(BASE_CONFIG.SERVICE_UUID);

  notifyCharacteristic  = await service.getCharacteristic(BASE_CONFIG.NOTIFY_CHAR_UUID);
  await notifyCharacteristic .startNotifications();
  notifyCharacteristic .addEventListener('characteristicvaluechanged', handleNotifications);

  writeCharacteristic = await service.getCharacteristic(BASE_CONFIG.WRITE_CHAR_UUID);

  return bluetoothDevice.name; // example: 'SN:0000000799'
}


/* Function which sends the initial 4-code pairing				      *
 * packet (see backside of the lock) and the Admin				      *
 * phone number and password. It then listens to notifications.			      */
export async function pairAndAuthenticate() {
  if (!CONFIG.PAIRING_PASSWORD) {
    throw new Error('CONFIG.PAIRING_PASSWORD is missing or empty!');
  }
  const pairingData = Array.from(CONFIG.PAIRING_PASSWORD, c => c.charCodeAt(0));
  const pairingPacket = createPacket(0x0F, pairingData);

	if (btDebug)
		console.log('Sending pairing-packet:', Array.from(pairingPacket).map(b => b.toString(16)));

  await writeWithRetry(pairingPacket);
}


/* Function which listens for notifications. This is the way we get answer */
function handleNotifications(event) {
  const response    = new Uint8Array(event.target.value.buffer);
  const cmd         = response[1];
  const status      = response[2];
  const dataLength  = response[3];

  if(btDebug)
	  console.log('Received response:', Array.from(response).map(b => b.toString(16).padStart(2, '0')));

  switch(cmd) { // CMD-byte

    case 0x0F: // Pairing response (See documentation 4.1e)
      if (response[2] === 0x10) {
        console.log('Pairing successfull! Ask for a random code (CMD=0x20)...');
        const randomCodePacket = createPacket(0x20); // 4.2 Get random code
        if (btDebug)
			    console.log('Sending random-code-packet:', Array.from(randomCodePacket).map(b => b.toString(16)));
        writeCharacteristic.writeValue(randomCodePacket);
      }
      break;

    case 0x20: // Random code response (See documentation 4.2d)
      if (response[2] === 0x10) {
        randomCode = response[response.length - 1]; // The last byte is the Random Code
        if (btDebug)
			    console.log('Random code:', randomCode.toString(16));
        authenticateAdmin();
      }
      break;

    case 0x21: // Authentication response (See documentation 4.3d)
	  isAuthenticated = status === 0x10;
      if (btDebug)
		    console.log(`Authentication status: ${response[2] === 0x10 ? 'Authenticated' : 'Error: 0x' + response[2].toString(16)}`);
      break;

  	case 0x60: // Battery status response
  	  if(response[2] === 0x10) {
  		  const voltage = (response[8] << 8) | response[9]; // According to the documentation, these are the voltage bytes.
    		if(pendingBatteryResolve) {
    		  pendingBatteryResolve({
    			voltage: voltage,
    			voltageString: voltage + 'mV',
    			percentage: calculateBatteryPercentage(voltage),
    			raw: Array.from(response)
    		  });
    		  pendingBatteryResolve = null;
    		}
  	  }
  	  break;

  	case 0x6C: // User information response

      if (status === 0x24) {	// Partial Data
		    const payload = response.slice(6, 6 + dataLength); // Skip header (6 bytes)
		    userDataBuffer.push(...Array.from(payload));
    		if (btDebug)
    			console.log('Received packet/part:', payload.length, 'bytes');
	    }
	    else if(status === 0x10) { // Final packet
    		const payload = response.slice(6, 6 + dataLength);
    		userDataBuffer.push(...Array.from(payload));
        if (btDebug)
    			console.log('Last packet/part received:', payload.length, 'bytes');

    		// Parse complete buffer
    		const users = parseUserData(userDataBuffer);
    		if (btDebug)
    			console.log('All users:', users);

    		// Reset buffer
    		userDataBuffer = [];
	    }
      break;

  	case 0x68:
  	  if (status === 0x10) {
  		  const password = String.fromCharCode(...response.slice(6, 12));
  
    		// Search the corect userId which had no password yet.
    		for (const [userId, handler] of pendingCreateUserPasswords.entries()) {
    		  if (!latestPasswords[userId]) {
      			latestPasswords[userId] = password;
      			handler.resolve(password);
      			pendingCreateUserPasswords.delete(userId);
      	        if (btDebug)
      				console.log(`Created password for user ${userId}: ${password}`);
      			break; // Stop at the first match
    		  }
    		  else {
      			console.warn('Duplicate or unexpected password response:', response);
    	    }
    		}
  	  }
  	  break;

    case 0x6B:
      if (status === 0x10) {
        console.log('All users deleted.');
      } else {
        console.warn(`Error during deleting: status=0x${status.toString(16)}`);
      }
      break;


    case 0x72: // Log response
      if (response[2] === 0x10) {
        if (btDebug)
      console.log('Logs received:', parseLogData(response));
      }
      break;
  }
}

function authenticateAdmin() {
  // Build data according to documentation (See documentation 4.3c)
  const adminData = [
    0x01, // Authentication type (0x01 = admin)
    ...parsePhoneNumber(CONFIG.ADMIN_PHONE), // Phone number in bytes
    ...Array.from(CONFIG.ADMIN_PASSWORD, c => c.charCodeAt(0)) // Password in ASCII
  ];

  // Encrypt with XOR (protocol 4.3f)
  const encryptedData = encryptData(adminData, randomCode);
  
  // Send packet
  const authPacket = createPacket(0x21, encryptedData);
  if (btDebug) {
  	console.log('Sending auth-packet:', Array.from(authPacket).map(b => b.toString(16)));
  	console.log('Encrypted data:', encryptedData.map(b => b.toString(16)));
  }
  writeCharacteristic.writeValue(authPacket);
}

/* Function to ask to receive user data */										 
export async function getUsers() {
  if (btDebug)
  	console.log('Requesting Userdata...');
  await writeCharacteristic.writeValue(createPacket(0x6C)); // Load users
}


/* Function to ask to receive logs */
export async function getLogs() {
  if (btDebug)
  	console.log('Requesting Logs...');
  await writeCharacteristic.writeValue(createPacket(0x72)); // Load logs
}

export function getUserBuffer() {
  return ;
}

export async function getBatteryLevel() {
  if (btDebug)
  	console.log('[Requesting Battery Status...');

  return new Promise(async (resolve, reject) => {
    if (pendingBatteryResolve) {
      reject(new Error('There is already a battery request running.'));
      return;
    }

    const timeout = setTimeout(() => {
      pendingBatteryResolve = null;
      reject(new Error('Timeout after 5 seconds'));
    }, 5000);

    pendingBatteryResolve = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };

    try {
      await writeWithRetry(createPacket(0x60));
    } catch (error) {
      pendingBatteryResolve = null;
      reject(error);
    }
  });
}

/**
 * Removes all users from the lock (commando 0x6B)
 */
export async function deleteAllUsers() {
  if (!isAuthenticated) throw new Error('Please authenticate first.');

  if (btDebug)
    console.log('Deleting all users...');
  await writeWithRetry(createPacket(0x6B));
}


/**
 * Disconnects Bluetooth and turns lock back to sleeping mode (See documentation: 4.19)
 * @returns {Promise<void>}
 */
export async function systemExit() {
  try {
    // 1. Send system Exit Command (0x6F)
    await writeWithRetry(createPacket(0x6F));
    
    // 2. Wait 500ms for response
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 3. Force disconnect if still connected
    if (bluetoothDevice?.gatt?.connected) {
      await bluetoothDevice.gatt.disconnect();
    }
    
    // 4. Reset internal state
    bluetoothDevice = null;
    writeCharacteristic = null;
    isAuthenticated = false;
    if (btDebug)
      console.log('Successfully logged and disconnected Bluetooth.');
  } catch (error) {
    console.error('Error during disconnect:', error);
    throw error;
  }
}



/*********************
 * USER MANAGEMENT *
 *********************/
export async function createUser(userId, startDate, endDate, options = {}) {
  if(!isAuthenticated) throw new Error('Please authenticate first.');
  
  // Choose the user type (Once/Periodic/OTP/...)
  const type = options.once ? 0x03 : 0x02; // 0x03 = Once, 0x02 = Periodic

  // Converter dates to BCD
  const startBCD = dateToBcd(startDate);
  const endBCD = dateToBcd(endDate);
  
  // Build the data packet
	const userData = [
	  type,
	  ...parsePhoneNumber(userId),
	  ...startBCD,
	  ...endBCD
	];

  pendingCreateUserPasswords.set(userId, { resolve: null }); // Remember that we expect a password, set the UserId for which it is.

  const pwdPromise = new Promise(resolve => {
    pendingCreateUserPasswords.get(userId).resolve = resolve;
  });

  await writeWithRetry(createPacket(0x68, userData));

  return pwdPromise;
}


/****************************************************************************
 * HELPER FUNCTIONS  														                            *
 ****************************************************************************/

/* FUNCTION TO SET THE CONFIG FROM OUTSIDE THIS LIBRARY, SEE README */ 
 export function setConfig(userConfig = {}) {
  CONFIG = {};

  /* MAKE ALL VARIABLES NAMES CAPITALS */
  for (const [key, value] of Object.entries(userConfig)) {
    CONFIG[key.toUpperCase()] = value;
  }
}

 /* This will create the packet according to format:
 STX(1byte) CMD(1byte) ASK(1byte) DATALEN(1byte) ETX(1byte) SUM(1byte) DATA(datalength bytes)

 STX=Data header, fixed value: 0xF5
 CMD=See command reference
 ASK=See response value table
 DATALEN=The data length
 ETX=Data footer, fixed value: 0x5F
 SUM=A checksum byte. Low byte of whole command packet, e.g., if sum of all data is 0x125D, then sum=0x5D.
 DATA=The data packets. If DATALEN=Null then Data is Null.
 */
function createPacket(cmd, data = []) {
  const STX = 0xF5;
  const ETX = 0x5F;
  const packet = [STX, cmd, 0x00, data.length, ETX];
  let sum = packet.reduce((a, b) => a + b, 0) + data.reduce((a, b) => a + b, 0);
  return new Uint8Array([...packet, sum & 0xFF, ...data]);
}

/* XOR-encryption like in protocol (see documentation: 4.3f) */
function encryptData(plainData, key) {
  return plainData.map(b => (b ^ key) % 256); // XOR with key
}

/* This function retransmits/retries our packets */
async function writeWithRetry(packet, retries = 3) {
  for(let i = 0; i < retries; i++) {
    try {
	  if (btDebug)
	    console.log('Writing packet:', Array.from(packet).map(b => b.toString(16).padStart(2, '0')));
      await writeCharacteristic.writeValue(packet);
      return;
    } catch(e) {
	  console.error(`Write error (attempt ${i+1}):`, e);
      if(i === retries-1) throw e;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

/* Function to create a phonenumber in the hex format that we need */
function parsePhoneNumber(phone) {
  // Convertert to string and fill until 12 numbers with leading zeros (6 bytes)
  const padded = String(phone).padStart(12, '0');
  return [
    parseInt(padded.substr(0, 2), 16),  // Byte 1 (bijv. 0x01)
    parseInt(padded.substr(2, 2), 16),  // Byte 2 (bijv. 0x58)
    parseInt(padded.substr(4, 2), 16),  // Byte 3 (bijv. 0x14)
    parseInt(padded.substr(6, 2), 16),  // Byte 4 (bijv. 0x01)
    parseInt(padded.substr(8, 2), 16),  // Byte 5 (bijv. 0x54)
    parseInt(padded.substr(10, 2), 16)  // Byte 6 (bijv. 0x70)
  ];
}


/* Function to convert dates to BCD.						            *
 * We need to set the data in BCD when creating a new code.	*
 * BCD means: tens << 4 | units.							              */
function dateToBcd(date) {
  return [
    decToBcd(date.getFullYear() % 100), // Year		(last 2 digits)
    decToBcd(date.getMonth() + 1),      // Month	(1-12)
    decToBcd(date.getDate()),           // Day		(1-31)
    decToBcd(date.getHours()),          // Hour		(0-23)
    decToBcd(date.getMinutes())         // Minutes	(0-59)
  ];
}
/* Function to convert Decimals to BCD	*
 * CD means: tens << 4 | units.			    */
function decToBcd(dec) {
  return ((Math.floor(dec / 10) << 4) | (dec % 10)) & 0xFF;
}

/* Function to convert date/time to a readable format. When getting the user info from the lock */
function parseDateTime(bytes) {
  try {
    const year = bcdToDec(bytes[0]) + 2000;
    const month = bcdToDec(bytes[1]);
    const day = bcdToDec(bytes[2]);
    const hour = bcdToDec(bytes[3]);
    const minute = bcdToDec(bytes[4]);

    /* Validate date/time */
    if (month < 1 || month > 12) throw new Error('Invalid month');
    if (day < 1 || day > 31) throw new Error('Invalid day');
    if (hour > 23) throw new Error('Invalid hour');
    if (minute > 59) throw new Error('Invalid minute');

    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  } catch(e) {
    console.error('Datetime parse error:', e.message);
	return `Invalid date/time (${bytes.map(b => b.toString(16)).join(':')})`;
  }
}

function bcdToDec(byte) {
  const high = (byte >> 4) & 0x0F; // First number (tens)
  const low = byte & 0x0F;         // Second number (units)
  return high * 10 + low;
}


/* These are the different types of users/codes there are. */
function getType(byte) {
  return {
    0x02: 'Periodic user',
    0x03: 'Once code/user',
    0x82: 'Expired periodic code',
    0x83: 'Expired once code'
  }[byte] || `Onbekend (0x${byte.toString(16)})`;
}

/* When reading the userID, get it in a readable 12-number phonenumber format */
function parseUserId(bytes) {
  // Convertert 6 bytes to a 12-numbering ID
  return bytes.map(b => 
    b.toString(16).padStart(2, '0')
  ).join('').replace(/^0+/, '');
}

/* When reading the password, get it in a 6 character ASCI format */
function parsePassword(bytes) {
  // 6 ASCII characters
  return String.fromCharCode(...bytes).replace(/\0/g, '');
}

export function parseUserData(dataBuffer) {
  const users = [];
  
  // Every user record is 24 bytes
  for(let i=0; i<dataBuffer.length; i+=24) {
    const chunk = dataBuffer.slice(i, i+24);
    if(chunk.length < 24) break;

    // Validate the checksum
    const checksum = chunk[23];
    const calculated = chunk.slice(0,23).reduce((a,b) => a + b, 0) & 0xFF;
    
    const user = {
      valid: checksum === calculated,
      type: getType(chunk[0]),
      userId: parseUserId(chunk.slice(1,7)),
      password: parsePassword(chunk.slice(7,13)),
      validFrom: parseDateTime(chunk.slice(13,18)),
      validTo: parseDateTime(chunk.slice(18,23)),
      raw: Array.from(chunk)
    };
    
    users.push(user);
  }
  return users;
}

function parseLogData(response) {
  const logBytes = response.slice(5); // Ignore header
  return {
    type: logBytes[0] === 0x01 ? 'Beheerder' : 'Gebruiker',
    telefoonnummer: logBytes.slice(1, 7).map(b => b.toString(16)).join(':'),
    datum: `${logBytes[7]}-${logBytes[8]}-${logBytes[9]}`,
    tijd: `${logBytes[10]}:${logBytes[11]}`
  };
}

function calculateBatteryPercentage(mv) {
  const min = CONFIG.BATTERY_MIN_MV || 3962;
  const max = CONFIG.BATTERY_MAX_MV || 6000;
  const perc = ((mv - min) / (max - min)) * 100;
  return parseFloat(Math.min(100, Math.max(0, perc)).toFixed(1));
}
