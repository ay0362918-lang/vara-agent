import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { Sails } from "sails-js";
import { SailsIdlParser } from "sails-js-parser";
import { setTimeout as wait } from "timers/promises";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

console.log("⚡ POLYBASKETS NATIVE SDK AGENT STARTING...");

const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN    = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE     = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL  = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const AGENT_NAME   = process.env.AGENT_NAME || "hy4";
const hexAddress   = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

let api, account, voucherId, sailsBetToken;
let approveCounter = 0;

function log(...args) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

// --- Load IDL once at startup ---
async function initSails() {
    const home = process.env.HOME || "";
    const idlCandidates = [
        process.env.BET_TOKEN_IDL,
        join(process.cwd(), "skills", "idl", "bet_token_client.idl"),
        join(home, ".agents", "skills", "polybaskets-skills", "idl", "bet_token_client.idl"),
        join("/root", ".agents", "skills", "polybaskets-skills", "idl", "bet_token_client.idl"),
    ].filter(Boolean);

    const idlPath = idlCandidates.find(p => existsSync(p));
    if (!idlPath) throw new Error("bet_token_client.idl not found — check skills install");

    const idl = readFileSync(idlPath, "utf-8");
    const parser = await SailsIdlParser.new();
    sailsBetToken = new Sails(parser);
    sailsBetToken.parseIdl(idl);
    sailsBetToken.setApi(api);
    sailsBetToken.setProgramId(BET_TOKEN);
    log("✅ Sails IDL loaded from:", idlPath);
}

async function init() {
    log("🔌 Connecting to Vara WebSocket...");
    api = await GearApi.create({ providerAddress: RPC });
    const keyring = new Keyring({ type: "sr25519" });
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY env var missing");
    account = keyring.addFromUri(process.env.PRIVATE_KEY);
    log("✅ Connected:", account.address);
    await initSails();
}

async function ensureVoucher() {
    try {
        const res = await fetch(`${VOUCHER_URL}/${hexAddress}`);
        const data = await res.json();
        if (data.voucherId && data.canTopUpNow === false) {
            voucherId = data.voucherId;
            return;
        }
        const postRes = await fetch(VOUCHER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                account: hexAddress,
                programs: [BASKET_MARKET, BET_TOKEN, BET_LANE],
            }),
        });
        const postData = await postRes.json();
        if (postData.voucherId) voucherId = postData.voucherId;
        else if (data.voucherId) voucherId = data.voucherId;
        log("🎫 Voucher:", voucherId);
    } catch (err) {
        log("⚠️ Voucher error:", err.message);
    }
}

// --- Native SDK approve — no CLI, no process spawn ---
async function approveBetLane() {
    if (!voucherId || !sailsBetToken) return false;

    try {
        // Randomize amount slightly so each tx has a unique payload (avoids dedup)
        const amount = 20000000000000 + Math.floor(Math.random() * 1_000_000);

        const tx = sailsBetToken.services.BetToken.functions.Approve(BET_LANE, amount);
        await tx.withAccount(account).withVoucher(voucherId).calculateGas();

        await new Promise((resolve, reject) => {
            tx.signAndSend(account, ({ status }) => {
                // isInBlock: count as soon as it lands in a block — don't wait for finalization
                if (status.isInBlock || status.isFinalized) {
                    approveCounter++;
                    log(`✅ Approve #${approveCounter} in block`);
                    resolve(true);
                }
            }).catch(reject);
        });

        return true;
    } catch (err) {
        log("❌ Approve error:", err.message?.slice(0, 120));
        return false;
    }
}

async function loop() {
    log("🚀 NATIVE SDK LOOP STARTED — no CLI, persistent WS");

    while (true) {
        try {
            // Refresh voucher every 50 approves
            if (approveCounter % 50 === 0) await ensureVoucher();
            await approveBetLane();
        } catch (err) {
            log("💥 Loop error:", err.message);
            await wait(500);
        }
    }
}

async function main() {
    await init();
    await ensureVoucher();
    await loop();
}

main().catch(err => {
    console.error("💥 Fatal:", err);
    process.exit(1);
});
