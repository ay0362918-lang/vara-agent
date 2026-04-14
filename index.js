import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";

dotenv.config();

console.log("🔥 SDK BOT STARTING...");

// 🔥 Replace if you confirm another program ID
const PROGRAM_ID = "0x702395d43248eaa5f1fd4d9eadadc75b0fb1c7c5ae9ea20bf31375fd4358f403";

let api;
let account;

async function init() {
  console.log("🔌 Connecting to Vara...");

  api = await GearApi.create({
    providerAddress: "wss://rpc.vara.network",
  });

  console.log("✅ Connected to Vara");

  const keyring = new Keyring({ type: "sr25519" });

  account = keyring.addFromUri(process.env.PRIVATE_KEY);

  console.log("🔐 Wallet loaded:", account.address);
}

// 🔥 CLAIM CHIP
async function claim() {
  try {
    console.log("🪙 Claiming CHIP...");

    const payload = { claim: {} };

    const tx = await api.message.send({
      destination: PROGRAM_ID,
      payload,
      gasLimit: 2000000000,
      value: 0,
    });

    await tx.signAndSend(account, ({ status }) => {
      console.log("📡 CLAIM TX:", status.toString());
    });

  } catch (err) {
    console.log("❌ Claim error:", err.message);
  }
}

// 🔥 PLACE BET
async function trade() {
  try {
    console.log("💰 Placing bet...");

    const payload = {
  bet: {
    amount: 1_000_000_000_000,
    timestamp: Date.now() // 🔥 makes every tx unique
  }
};

    const tx = await api.message.send({
      destination: PROGRAM_ID,
      payload,
      gasLimit: 2000000000,
      value: 0,
    });

    await tx.signAndSend(account, ({ status }) => {
      console.log("📡 BET TX:", status.toString());
    });

  } catch (err) {
    console.log("❌ Trade error:", err.message);
  }
}

// 🔁 LOOP
async function loop() {
  console.log("🚀 LOOP STARTED");

  while (true) {
    console.log("🔁 New cycle");

    await claim();

    // 🔥 ADD THIS
    await wait(5000);

    await trade();

    console.log("⏳ Sleeping 1 min...");
    await wait(60000);
  }
}

async function main() {
  await init();
  await loop();
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
});
