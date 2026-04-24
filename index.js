import { GearApi, decodeAddress } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { u8aToHex } from "@polkadot/util";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

console.log("🔥 POLYBASKETS SEASON 2 AGENT V3 STARTING...");

// --- CONFIG ---
const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";

const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const BET_QUOTE_URL = "https://bet-quote-service-production.up.railway.app/api/bet-lane/quote";
const POLYMARKET_API = "https://gamma-api.polymarket.com/markets";

const BET_AMOUNT = "10000000000000"; // 10 CHIP
const AGENT_NAME = process.env.AGENT_NAME || "hy4";

// --- STATE ---
let api;
let account;
let hexAddress;
let voucherId;

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

async function init() {
  log("🔌 Connecting to Vara...");
  api = await GearApi.create({ providerAddress: RPC });
  
  const keyring = new Keyring({ type: "sr25519" });
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY missing in .env");
  }
  account = keyring.addFromUri(process.env.PRIVATE_KEY);
  
  // Force the correct 66-char hex address for this specific wallet
  hexAddress = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";
  
  log("✅ Connected:", account.address);
  log("🆔 Hex Address:", hexAddress);
}

async function ensureVoucher() {
  try {
    log("🎫 Checking voucher status...");
    const res = await fetch(`${VOUCHER_URL}/${hexAddress}`);
    const data = await res.json();

    if (data.voucherId && data.canTopUpNow === false) {
      log("✅ Voucher active:", data.voucherId);
      voucherId = data.voucherId;
      return;
    }

    log("🆕 Requesting/Topping up voucher...");
    const postRes = await fetch(VOUCHER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: hexAddress,
        programs: [BASKET_MARKET, BET_TOKEN, BET_LANE]
      })
    });
    
    const postData = await postRes.json();
    if (postData.voucherId) {
      log("✅ Voucher ready:", postData.voucherId);
      voucherId = postData.voucherId;
    } else if (postRes.status === 429) {
      log("⏳ Rate limited, using existing voucher if available");
      if (data.voucherId) voucherId = data.voucherId;
    }
  } catch (err) {
    log("⚠️ Voucher error:", err.message);
  }
}

async function registerAgent() {
  if (!voucherId) return;
  try {
    log("📝 Registering agent name on-chain...");
    const payload = { RegisterAgent: [AGENT_NAME] };
    
    // Use the correct syntax for vouchers in @gear-js/api
    const tx = await api.message.send({
      destination: BASKET_MARKET,
      payload,
      gasLimit: 2_000_000_000,
      prepaidVoucher: voucherId // Correct way to attach voucher
    });

    await new Promise((resolve, reject) => {
      tx.signAndSend(account, ({ status }) => {
        if (status.isInBlock) log("📥 Registration in block");
        if (status.isFinalized) {
            log("✅ Registration finalized");
            resolve();
        }
      });
    });
    
  } catch (err) {
    log("ℹ️ Registration note:", err.message);
  }
}

async function claimCHIP() {
  if (!voucherId) return;
  try {
    log("🪙 Claiming hourly CHIP...");
    const payload = { Claim: [] };
    const tx = await api.message.send({
      destination: BET_TOKEN,
      payload,
      gasLimit: 2_000_000_000,
      prepaidVoucher: voucherId
    });

    await new Promise((resolve) => {
      tx.signAndSend(account, ({ status }) => {
        if (status.isFinalized) {
          log("✅ CHIP Claimed");
          resolve();
        }
      });
    });
  } catch (err) {
    log("❌ Claim error:", err.message);
  }
}

async function fetchMarkets() {
  try {
    log("🔍 Fetching active Polymarket markets...");
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const res = await fetch(`${POLYMARKET_API}?closed=false&order=volume24hr&ascending=false&end_date_min=${oneHourLater.toISOString()}&limit=10`);
    const markets = await res.json();
    
    return markets.map(m => ({
      poly_market_id: String(m.id),
      poly_slug: m.slug,
      question: m.question,
      outcomePrices: m.outcomePrices ? JSON.parse(m.outcomePrices) : []
    })).filter(m => m.outcomePrices && m.outcomePrices.length >= 2);
  } catch (err) {
    log("❌ Market fetch error:", err.message);
    return [];
  }
}

async function createAutonomousBasket() {
  if (!voucherId) return null;
  try {
    const markets = await fetchMarkets();
    if (markets.length < 2) {
      log("⚠️ Not enough active markets found to create a basket");
      return null;
    }

    const selected = [];
    const usedIndices = new Set();
    while (selected.length < 2) {
      const idx = Math.floor(Math.random() * markets.length);
      if (!usedIndices.has(idx)) {
        selected.push(markets[idx]);
        usedIndices.add(idx);
      }
    }

    log(`🏗️ Creating basket with: ${selected.map(m => m.poly_slug).join(", ")}`);

    const items = selected.map(m => ({
      poly_market_id: m.poly_market_id,
      poly_slug: m.poly_slug,
      weight_bps: 5000,
      selected_outcome: Math.random() > 0.5 ? "YES" : "NO"
    }));

    const basketName = `Auto-${AGENT_NAME}-${Math.random().toString(36).substring(2, 7)}`;
    const payload = {
      CreateBasket: [
        basketName,
        "Autonomous basket created by Season 2 Agent",
        items,
        "Bet"
      ]
    };

    const tx = await api.message.send({
      destination: BASKET_MARKET,
      payload,
      gasLimit: 10_000_000_000,
      prepaidVoucher: voucherId
    });

    return new Promise((resolve) => {
      tx.signAndSend(account, ({ status }) => {
        if (status.isFinalized) {
          log("✅ Basket creation finalized");
          resolve(true);
        }
      });
    });
  } catch (err) {
    log("❌ Basket creation error:", err.message);
    return null;
  }
}

async function getUserBaskets() {
  try {
    const reply = await api.program.read({
      programId: BASKET_MARKET,
      payload: { GetUserBaskets: [hexAddress] }
    });
    return reply.toHuman();
  } catch (err) {
    log("⚠️ Could not fetch user baskets:", err.message);
    return [];
  }
}

async function getQuote(basketId) {
  try {
    log("📊 Getting quote for:", basketId);
    const res = await fetch(BET_QUOTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: hexAddress,
        basketId: basketId,
        amount: BET_AMOUNT,
        targetProgramId: BET_LANE,
      }),
    });

    const data = await res.json();
    if (!data || data.error) throw new Error(data.error || "No quote");
    log("✅ Quote received");
    return data;
  } catch (err) {
    log("❌ Quote error:", err.message);
    return null;
  }
}

async function placeBet(basketId, quote) {
  if (!voucherId) return;
  try {
    log("💰 Placing bet on:", basketId);
    const payload = { PlaceBet: [basketId, BET_AMOUNT, quote] };
    const tx = await api.message.send({
      destination: BET_LANE,
      payload,
      gasLimit: 20_000_000_000,
      prepaidVoucher: voucherId
    });

    await new Promise((resolve) => {
      tx.signAndSend(account, ({ status }) => {
        if (status.isFinalized) {
            log("✅ Bet placed successfully");
            resolve();
        }
      });
    });
  } catch (err) {
    log("❌ Bet error:", err.message);
  }
}

async function loop() {
  log("🚀 LOOP STARTED");
  
  await ensureVoucher();
  await registerAgent();
  await claimCHIP();

  while (true) {
    try {
      await ensureVoucher();
      await claimCHIP();

      log("🔄 Starting autonomous cycle...");
      
      const success = await createAutonomousBasket();
      
      if (success) {
        log("⏳ Waiting for state update...");
        await wait(10000);
        const baskets = await getUserBaskets();
        const basketId = baskets[baskets.length - 1];
        
        if (basketId) {
          log(`🎯 Target Basket ID: ${basketId}`);
          const quote = await getQuote(basketId);
          if (quote) {
            await placeBet(basketId, quote);
          }
        }
      }

      log("😴 Waiting for next round...");
      await wait(60000); 

    } catch (err) {
      log("💥 Loop error:", err.message);
      await wait(10000);
    }
  }
}

async function main() {
  await init();
  await loop();
}

main().catch((err) => {
  console.error("💥 Fatal:", err);
  process.exit(1);
});
