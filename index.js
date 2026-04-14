import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";

dotenv.config();

console.log("🔥 SDK BOT STARTING...");

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

async function claim() {
  console.log("🪙 Claiming CHIP...");
  
  // TEMP placeholder (real contract call later)
  console.log("⚠️ Claim not implemented yet");
}

async function trade() {
  console.log("📊 Trading cycle...");
  
  // TEMP placeholder
  console.log("⚠️ Trade not implemented yet");
}

async function loop() {
  console.log("🚀 LOOP STARTED");

  while (true) {
    console.log("🔁 New cycle");

    await claim();
    await trade();

    console.log("⏳ Sleeping 5 mins...");
    await wait(300000);
  }
}

async function main() {
  await init();
  await loop();
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
});
