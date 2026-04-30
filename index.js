import { GearApi, decodeAddress } from "@gear-js/api";
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
const BET_TOKEN     = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE      = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL   = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const AGENT_NAME    = process.env.AGENT_NAME || "hy4";
const hexAddress    = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

// Pre-decode BET_LANE actor_id once — this was the WASM crash cause
const BET_LANE_ACTOR_ID = decodeAddress(BET_LANE);

let api, account, voucherId, sailsBetToken;
let approveCounter = 0;

function log(...args) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

async function initSails() {
    const home = process.env.HOME || "/root";
    const idlCandidates = [
        process.env.BET_TOKEN_IDL,
        join(process.cwd(), "skills", "idl", "bet_token_client.idl"),
        join(home, ".agents", "skills", "polybaskets-skills", "idl", "bet_token_client.idl"),
    ].filter(Boolean);

    const idlPath = idlCandidates.find(p => existsSync(p));
    if (!idlPath) throw new Error("bet_token_client.idl not found");

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
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
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
                programs: [BASKET_MARKET, BET_TOKEN, BET_LANE]
            })
        });
        const postData = await postRes.json();
        if (postData.voucherId) voucherId = postData.voucherId;
        else if (data.voucherId) voucherId = data.voucherId;
        log("🎫 Voucher:", voucherId);
    } catch (err) {
        log("⚠️ Voucher error:", err.message);
    }
}

async function approveBetLane() {
    if (!voucherId || !sailsBetToken) return false;

    try {
        const amount = BigInt(20000000000000) + BigInt(Math.floor(Math.random() * 1_000_000));

        // KEY FIX: pass decoded actor_id, not raw hex string
        // KEY FIX: amount as BigInt for u256
        const tx = sailsBetToken.services.BetToken.functions.Approve(
            BET_LANE_ACTOR_ID,
            amount
        );

        await tx
            .withAccount(account)
            .withVoucher(voucherId)
            .calculateGas();

        await new Promise((resolve, reject) => {
            tx.signAndSend(account, ({ status, events }) => {
                if (status.isInBlock) {
                    approveCounter++;
                    log(`✅ Approve #${approveCounter} in block`);
                    resolve(true);
                }
                if (status.isError) {
                    reject(new Error("tx error status"));
                }
            }).catch(reject);
        });

        return true;
    } catch (err) {
        log("❌ Approve error:", String(err.message || err).slice(0, 100));
        return false;
    }
}

async function loop() {
    log("🚀 NATIVE SDK LOOP — no CLI, persistent WS");

    while (true) {
        try {
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
