import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";

dotenv.config();

console.log("🔥 LIVE BOT STARTING...");

// RPC
const RPC = "wss://rpc.vara.network";

// PROGRAMS
const BET_LANE =
  "0xf5aa436669bb3fc97c1675d06949592e8617f889cbd055451f321113b17bb564";

// CONFIG
const BET_AMOUNT = "100000000000000"; // 100 CHIP

// 🔥 REAL LIVE BASKETS (IMPORTANT)
const LIVE_BASKETS = [
  "cm5-no-boe",
  "cm5-no-maduro",
  "cm5-no-gemini",
  "cm5-no-jdg",
  "cm5-no-claude5",
  "cm5-no-marlins",
];

let api;
let account;

// LOG
function log(...args) {
  console.log(new Date().toLocaleTimeString(), ...args);
}

// INIT
async function init() {
  log("🔌 Connecting...");

  api = await GearApi.create({
    providerAddress: RPC,
  });

  const keyring = new Keyring({ type: "sr25519" });
  account = keyring.addFromUri(process.env.PRIVATE_KEY);

  log("✅ Connected:", account.address);
}

// GET QUOTE
async function getQuote(basketId) {
  try {
    log("📊 Getting quote for:", basketId);

    const res = await fetch(
      "https://bet-quote-service-production.up.railway.app/api/bet-lane/quote",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: account.address,
          basketId: basketId, // 🔥 STRING ID
          amount: BET_AMOUNT,
          targetProgramId: BET_LANE,
        }),
      }
    );

    const data = await res.json();

    if (!data) throw new Error("No quote");

    log("✅ Quote received");

    return data;
  } catch (err) {
    log("❌ Quote error:", err.message);
    return null;
  }
}

// PLACE BET
async function placeBet(basketId, quote) {
  try {
    log("💰 Betting on:", basketId);

    const payload = {
      PlaceBet: [basketId, BET_AMOUNT, quote],
    };

    const tx = await api.message.send({
      destination: BET_LANE,
      payload,
      gasLimit: 20_000_000_000,
    });

    await new Promise((resolve) => {
      tx.signAndSend(account, ({ status }) => {
        log("📡 BET:", status.toString());

        if (status.isFinalized) resolve();
      });
    });
  } catch (err) {
    log("❌ Bet error:", err.message);
  }
}

// LOOP
async function loop() {
  log("🚀 LOOP STARTED");

  while (true) {
    try {
      const basketId =
        LIVE_BASKETS[Math.floor(Math.random() * LIVE_BASKETS.length)];

      log("🎯 Selected:", basketId);

      const quote = await getQuote(basketId);

      if (!quote) {
        await wait(5000);
        continue;
      }

      await placeBet(basketId, quote);

      await wait(8000); // speed

    } catch (err) {
      log("💥 Loop error:", err.message);
      await wait(5000);
    }
  }
}

// START
async function main() {
  await init();
  await loop();
}

main().catch((err) => {
  console.error("💥 Fatal:", err);
});
