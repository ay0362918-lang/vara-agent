import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";

dotenv.config();

console.log("🔥 REAL BOT STARTING...");

// 🔥 CONSTANTS
const RPC = "wss://rpc.vara.network";

// PROGRAMS
const BET_LANE = "0xf5aa436669bb3fc97c1675d06949592e8617f889cbd055451f321113b17bb564";
const PROGRAM_ID = "0x702395d43248eaa5f1fd4d9eadadc75b0fb1c7c5ae9ea20bf31375fd4358f403";

// BET CONFIG
const BET_AMOUNT = "100000000000000"; // 100 CHIP
const BASKET_ID = 0;

let api;
let account;

// 🔥 SAFE LOGGING
function log(...args) {
  console.log(new Date().toLocaleTimeString(), ...args);
}

// 🔥 INIT
async function init() {
  log("🔌 Connecting to Vara...");

  api = await GearApi.create({
    providerAddress: RPC,
  });

  const keyring = new Keyring({ type: "sr25519" });
  account = keyring.addFromUri(process.env.PRIVATE_KEY);

  log("✅ Connected");
  log("🔐 Wallet:", account.address);
}

// 🔥 CLAIM CHIP
async function claim() {
  try {
    log("🪙 Claiming CHIP...");

    const payload = { claim: {} };

    const tx = await api.message.send({
      destination: PROGRAM_ID,
      payload,
      gasLimit: 2_000_000_000,
    });

    await new Promise((resolve) => {
      tx.signAndSend(account, ({ status }) => {
        log("📡 CLAIM:", status.toString());
        if (status.isFinalized) resolve();
      });
    });

  } catch (err) {
    log("❌ Claim error:", err.message);
  }
}

// 🔥 GET SIGNED QUOTE (CRITICAL)
async function getQuote() {
  try {
    log("📊 Getting quote...");

    const res = await fetch(
      "https://bet-quote-service-production.up.railway.app/api/bet-lane/quote",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: account.address,
          basketId: BASKET_ID,
          amount: BET_AMOUNT,
          targetProgramId: BET_LANE,
        }),
      }
    );

    const data = await res.json();

    if (!data) throw new Error("No quote received");

    log("✅ Quote received");

    return data;
  } catch (err) {
    log("❌ Quote error:", err.message);
    return null;
  }
}

// 🔥 PLACE REAL BET (THIS COUNTS)
async function placeBet(quote) {
  try {
    log("💰 Placing REAL bet...");

    const payload = {
      PlaceBet: [BASKET_ID, BET_AMOUNT, quote],
    };

    const tx = await api.message.send({
      destination: BET_LANE,
      payload,
      gasLimit: 20_000_000_000,
    });

    await new Promise((resolve, reject) => {
      tx.signAndSend(account, ({ status }) => {
        log("📡 BET:", status.toString());

        if (status.isFinalized) resolve();
      }).catch(reject);
    });

  } catch (err) {
    log("❌ Bet error:", err.message);
  }
}

// 🔁 MAIN LOOP
async function loop() {
  log("🚀 LOOP STARTED");

  while (true) {
    try {
      log("🔁 New cycle");

      // 1. CLAIM
      await claim();

      await wait(3000);

      // 2. GET QUOTE
      const quote = await getQuote();

      if (!quote) {
        log("⚠️ Skipping bet (no quote)");
        await wait(5000);
        continue;
      }

      // 3. PLACE BET (IMMEDIATELY)
      await placeBet(quote);

      // 🔥 SHORT DELAY = HIGH ACTIVITY
      await wait(10000);

    } catch (err) {
      log("💥 Loop error:", err.message);
      await wait(5000);
    }
  }
}

// 🔥 ERROR HANDLING (PREVENT CRASH)
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED:", err);
});

// 🚀 START
async function main() {
  await init();
  await loop();
}

main();
