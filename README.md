# Kerong Bluetooth Lock JavaScript Library
A JavaScript library to interact with Kerong Bluetooth Locks (e.g., KR-T153-BT) directly from modern web browsers. Program user codes, check battery levels, manage access logs, and control locks using the Web Bluetooth API. Ideal for smart locker systems, rental platforms, or IoT access control.
This library -tries- to implement the official Kerong Bluetooth Communication Protocol v3.1 (see PDF documentation).

## Why I made this
The Kerong Locks are really good quality (IP68 and stainless steel!) for a very cheap price. The API/Documentation is publicly available.
There are other locks, but they all charge a FEE (monthy or per code) to create codes!
- Eurolocks 3781 and 3961 (which charge you for a montly fee to use 'RAS' (Remote Allocation System) which has a crazy price!)
- Kitlock KL1000G3 met Netcode (asks 0.20EUR to create a code from their Cloud portal)
- Digilock Versa (which ask a minimal fee of EUR 125,- a month which is for 100 locks)


## Features
- Pair with locks using factory/admin credentials
- Create/delete temporary or permanent user codes
- Retrieve battery status and lock metadata
- Full compliance with Kerong's Bluetooth Communication Protocol
- Supports Web Bluetooth (Chrome/Edge for desktop & Android) or using Bluefy (browser with Bluetooth support on IOS/iPhone)

## Features

- **Pairing & Authentication**  
  Secure connection setup with factory pairing codes and admin credentials
- **User Management**  
  Create/delete permanent or one-time access codes with expiry dates
- **Real-Time Monitoring**  
  Get battery levels, lock status, and access logs
- **Web Bluetooth API**  
  No apps required - works directly in compatible browsers

## Installation / Example
Create a webpage with following code (this is an example to connect/pair, delete all codes and create new ones and to disconnect).

```javascript
<button id="btn-connect" type="button">Pair and Connect</button>
<button id="btn-users" type="button">Create Userscodes</button>
<button id="btn-logout" type="button">Disconnect</button>

<script type="module">
const config = {
  PAIRING_PASSWORD: '9155',    // Found on lock backplate
  ADMIN_PHONE: '15814015470',  // Admin account phone
  ADMIN_PASSWORD: '000000'     // Default admin password
};

/* IMPORTS */
import {
  setConfig,
  connectToDevice,
  pairAndAuthenticate,
  createUser,
  getBatteryLevel,
  deleteAllUsers,
  systemExit
} from 'https://cdn.jsdelivr.net/npm/kerong-bluetooth-lock/dist/kerong-lock.min.js';

/* HELPER FUNCTION */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/* MAIN CODE */
document.getElementById('btn-connect').addEventListener('click', handleConnect);
document.getElementById('btn-users').addEventListener('click', generateAndUploadCodes);
document.getElementById('btn-logout').addEventListener('click', handleLogout);

async function handleConnect() {
  try {
    log("Connecting to Lock...");
    const serial_raw		= await connectToDevice();

    setConfig(config);
    
    await pairAndAuthenticate();
    console.log("Succesfully authenticated");

    await delay(500);
    
    // Retrieve Battery state
    const battery = await getBatteryLevel();
    log(`Battery state: ${battery.voltageString} (${battery.percentage}%)`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

async function generateAndUploadCodes() {
  try {
    console.log("Removing all current user codes...");
    await deleteAllUsers();
    
    await delay(2000);
    
    console.log("Generating new codes..");
    const now		= new Date();
    const past		= new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
    const year		= new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    const tenyear	= new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
    const codes		= [];

    // Once codes (1 year valid)
    for (let i = 1000; i <= 1010; i++) {
      const endDate = new Date(); 
      endDate.setHours(23, 59, 0);
      
      const password = await createUser(i, past, year, { once: true });
      codes.push({ user: i, type: 'once', password });
      console.log(`Once usercode created: ${i}`);
      await delay(500);
    }

    // Permanent codes (10 years valid)
    for (let i = 1200; i <= 1210; i++) {
      const password = await createUser(i, past, tenyear);
      codes.push({ user: i, type: 'permanent', password });
      console.log(`Permanent usercode created: ${i}`);
      await delay(500);
    }
    console.log(`The usercodes/passwords are: ${codes}`);
    console.log("Disconnecting...");
    await systemExit();

  } catch (error) {
    console.error(error);
  }
}

async function handleLogout() {
  try {
    await systemExit();
  } catch (error) {
    error.log(`Failed to disconnect: ${error.message}`);
  }
}
```

## Browser Support
- Chrome 56+ (Desktop/Android)
- Edge 79+
- Opera 43+
- BlueFly (Bluetooth enabled browser for IOS/iPhone/iPad)

## Other Requirements:
- HTTPS connection (required for Web Bluetooth), so host your code/website on https.
- User gesture initiation (e.g., button click)

## Limitations
- Always requires a user click (to pair bluetooth from the browser).
- Requires to be in the area of the Bluetooth Lock (about 30 meters is maximum).
- Does NOT handle firmware updates.
- Web Bluetooth support still experimental in some browsers.

## API Reference
|Function|Description|
|--------|-----------|
|connectToDevice()|Initiates Bluetooth connection|
|pairAndAuthenticate()|Validates pairing code & admin credentials|
|getBatteryLevel()|Returns voltage + percentage estimate|
|createUser()|Generates time-bound access codes|
|deleteAllUsers()|Removes all user codes|
|getLogs()|Retrieves unlock history|


## ToDo
Rewriting / cleaning the code. Especially the handling of notifications and waiting for it.. making it more robust.
Please help me, contribute! :)

## Contributing
PRs welcome! Ensure compliance with Kerong's protocol documentation.

## License
MIT © Roel Broersma

## Disclaimer
Not affiliated with Kerong Industry Co. Use at your own risk.


## Kerong KR-T-153 Technical information
|Feature|Details|
|-------|-------|
|Name|Electronic Digital Cam Lock|
|Brand|KERONG|
|Model|KR-T153|
|Material|ABS+PC+Zinc Alloy|
|Size|153x40x60mm|
|Type|Cam Lock|
|Battery|DC 4.5V (3x AAA battery)|
|Auxilary|USB-C for emergency powering to unlock when battery is empty, see picture|
|Driven mode|Motor/servo|
|Unlock way|Password or Bluetooth|
|Protection class|IP66|
|Working temperature|-20℃ ~ +65℃|
|Working humidity|10% ~ 90%RH|
|Expected Working life|500000 times|
|Outdoor Tests|Salt spray testing 72 hours|
|Certifications|CE; ISO9001; RoHS|

![image](https://github.com/user-attachments/assets/f275ea35-9c2d-484e-82a5-58a0e2e7aedf)
![image](https://github.com/user-attachments/assets/3d47fb11-d6ee-411a-9310-dc190d87270a)
See the USB-C port above behind the cap. When the batteries are empty and you need to unlock the lock, hang on a USB-C powerbank and you can at least connect with Bluetooth again or use one of your codes.


## Official APPs
- IOS (iPhone/iPad) Admin App: https://apps.apple.com/us/app/kerong-cabinet-lock-admin/id1475870199
- IOS (iPhone/IPad) Client App (no Admin functions): https://apps.apple.com/us/app/kerong-smart-cabinet-lock/id1475870366
- Android Admin App: https://play.google.com/store/apps/details?id=com.feexon.intelligentlockadmin&hl=en&pli=1
- Android Client App: https://play.google.com/store/apps/details?id=com.feexon.intelligentlockuser&hl=en
- 
