import { GearApi, decodeAddress } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { u8aToHex } from "@polkadot/util";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

console.log("🔥 POLYBASKETS SEASON 2 AUTONOMOUS AGENT STARTING...");

// --- CONFIG ---
const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";

const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const BET_QUOTE_URL = "https://bet-quote-service-production.up.railway.app/api/bet-lane/quote";
const POLYMARKET_API = "https://gamma-api.polymarket.com/markets";

const BET_AMOUNT = "10000000000000"; // 10 CHIP
const AGENT_NAME = process.env.AGENT_NAME || "autonomous-agent";

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
  
  // Get the hex address from the account
  hexAddress = u8aToHex(decodeAddress(account.address));
  
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
    
    const tx = await api.message.send({
      destination: BASKET_MARKET,
      payload,
      gasLimit: 2_000_000_000,
      prepaidVoucher: voucherId
    });

    await new Promise((resolve, reject) => {
      tx.signAndSend(account, ({ status, events }) => {
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
    const now = new Date().toISOString();
    const res = await fetch(`${POLYMARKET_API}?closed=false&order=volume24hr&ascending=false&end_date_min=${now}&limit=10`);
    const markets = await res.json();
    
    return markets.map(m => ({
      poly_market_id: String(m.id),
      poly_slug: m.slug,
      question: m.question,
      prices: JSON.parse(m.outcomePrices)
    })).filter(m => m.prices && m.prices.length >= 2);
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
      log("⚠️ Not enough active markets found");
      return null;
    }

    // Pick 2 random markets for the basket
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
      weight_bps: 5000, // 50% each
      selected_outcome: "YES"
    }));

    const basketName = `Auto-${Math.random().toString(36).substring(7)}`;
    const payload = {
      CreateBasket: [
        basketName,
        "Autonomous basket created by Season 2 Agent",
        items,
        "Bet" // Use CHIP lane
      ]
    };

    const tx = await api.message.send({
      destination: BASKET_MARKET,
      payload,
      gasLimit: 10_000_000_000,
      prepaidVoucher: voucherId
    });

    return new Promise((resolve) => {
      tx.signAndSend(account, ({ status, events }) => {
        if (status.isFinalized) {
          // Find the basket ID from events
          for (const { event } of events) {
            if (event.method === 'UserMessageSent') {
              // In Gear, the reply usually contains the result.
              // For simplicity in this script, we'll wait for the next block and query the last basket.
              log("✅ Basket creation transaction finalized");
              resolve(true);
            }
          }
          resolve(true);
        }
      });
    });
  } catch (err) {
    log("❌ Basket creation error:", err.message);
    return null;
  }
}

async function getLastBasketId() {
  try {
    // Query the contract for the user's baskets
    // This is a simplified way to get the latest basket ID created by the user
    const payload = { GetUserBaskets: [hexAddress] };
    const reply = await api.program.read({
      programId: BASKET_MARKET,
      payload
    }, api.code.get(BASKET_MARKET));
    
    const baskets = reply.toHuman();
    if (Array.isArray(baskets) && baskets.length > 0) {
      return baskets[baskets.length - 1];
    }
  } catch (err) {
    log("⚠️ Could not fetch user baskets:", err.message);
  }
  return null;
}

async function getQuote(basketId) {
  try {
    log("📊 Getting quote for basket:", basketId);
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
    log("💰 Placing bet on basket:", basketId);
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
  log("🚀 AUTONOMOUS LOOP STARTED");
  
  await init();
  await ensureVoucher();
  await registerAgent();
  await claimCHIP();

  while (true) {
    try {
      await ensureVoucher();
      await claimCHIP();

      log("🔄 Starting autonomous cycle...");
      
      // 1. Create a new basket
      const created = await createAutonomousBasket();
      if (created) {
        // Wait a bit for indexer/state to catch up
        await wait(5000);
        
        // 2. Get the ID of the basket we just created
        const basketId = await getLastBasketId();
        
        if (basketId) {
          log(`🎯 Target Basket ID: ${basketId}`);
          
          // 3. Get quote and place bet
          const quote = await getQuote(basketId);
          if (quote) {
            await placeBet(basketId, quote);
          }
        }
      }

      log("😴 Waiting 5 minutes for next cycle...");
      await wait(300000); 

    } catch (err) {
      log("💥 Loop error:", err.message);
      await wait(30000);
    }
  }
}

loop().catch((err) => {
  console.error("💥 Fatal:", err);
  process.exit(1);
});
