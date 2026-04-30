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

console.log("🚀 POLYBASKETS HIGH-THROUGHPUT AGENT STARTING...");

const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN     = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE      = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL   = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const hexAddress    = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

const BET_LANE_ACTOR_ID = decodeAddress(BET_LANE);

let api, account, voucherId, sailsBetToken;
let currentNonce;
let approveCounter = 0;
let pendingTxs = 0;
const MAX_PENDING = 50; 

function log(...args) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

async function initSails() {
    const home = process.env.HOME || "/root";
    const idlCandidates = [
        process.env.BET_TOKEN_IDL,
        join(process.cwd(), "skills", "idl", "bet_token_client.idl"),
        join(home, ".agents", "skills", "polybaskets-skills", "idl", "bet_token_client.idl"),
        "/home/ubuntu/skills/idl/bet_token_client.idl"
    ].filter(Boolean);

    const idlPath = idlCandidates.find(p => existsSync(p));
    if (!idlPath) throw new Error("bet_token_client.idl not found");

    const idl = readFileSync(idlPath, "utf-8");
    const parser = await SailsIdlParser.new();
    sailsBetToken = new Sails(parser);
    sailsBetToken.parseIdl(idl);
    sailsBetToken.setApi(api);
    sailsBetToken.setProgramId(BET_TOKEN);
    log("✅ Sails IDL loaded");
}

async function init() {
    log("🔌 Connecting to Vara...");
    api = await GearApi.create({ providerAddress: RPC });
    const keyring = new Keyring({ type: "sr25519" });
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
    account = keyring.addFromUri(process.env.PRIVATE_KEY);
    
    const { nonce } = await api.query.system.account(account.address);
    currentNonce = nonce.toNumber();
    
    log("✅ Connected:", account.address, "| Initial Nonce:", currentNonce);
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
        voucherId = postData.voucherId || data.voucherId;
        log("🎫 Voucher updated:", voucherId);
    } catch (err) {
        log("⚠️ Voucher error:", err.message);
    }
}

async function sendApprovePipelined() {
    if (!voucherId || !sailsBetToken || pendingTxs >= MAX_PENDING) return;

    const amount = BigInt(20000000000000) + BigInt(Math.floor(Math.random() * 1000000));
    
    try {
        // FINAL FIX: In sails-js 0.5.1, the correct way to get the payload is .encodePayload() 
        // but it's on the function call object. If that failed, we use the service's encoder.
        const payload = sailsBetToken.services.BetToken.functions.Approve(
            BET_LANE_ACTOR_ID,
            amount
        ).publish().payload; // This is the most reliable way to get the encoded payload in 0.5.1

        const nonce = currentNonce++;
        pendingTxs++;

        const extrinsic = api.tx.voucher.call(voucherId, {
            SendMessage: {
                destination: BET_TOKEN,
                payload: payload,
                gasLimit: 50_000_000_000,
                value: 0,
                keepAlive: true
            }
        });

        extrinsic.signAndSend(account, { nonce }, ({ status, dispatchError }) => {
            if (status.isInBlock || status.isFinalized) {
                pendingTxs--;
                approveCounter++;
                if (approveCounter % 10 === 0) log(`🔥 Total Approves: ${approveCounter} | Pending: ${pendingTxs}`);
            }
            if (dispatchError) {
                pendingTxs--;
                log("❌ Dispatch Error");
            }
            if (status.isUsurped || status.isDropped || status.isInvalid) {
                pendingTxs--;
                log(`⚠️ Tx ${status.type}`);
            }
        }).catch(err => {
            pendingTxs--;
            log("💥 Send Error:", err.message);
        });

    } catch (err) {
        log("❌ Build error:", err.message);
    }
}

async function loop() {
    log("🚀 STARTING HIGH-SPEED PIPELINE");
    
    setInterval(ensureVoucher, 60000);

    while (true) {
        if (pendingTxs < MAX_PENDING) {
            sendApprovePipelined();
            await wait(50); 
        } else {
            await wait(100);
        }
        
        if (approveCounter > 0 && approveCounter % 1000 === 0) {
            const { nonce } = await api.query.system.account(account.address);
            currentNonce = Math.max(currentNonce, nonce.toNumber());
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
