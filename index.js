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

if (!process.env.PRIVATE_KEY) { console.error("💥 PRIVATE_KEY not set"); process.exit(1); }

console.log("⚡ HY4 NATIVE SDK");

const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const hexAddress = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

let api, account, voucherId, sails;
let approveCounter = 0;

function log(...args) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

async function initSails() {
    const home = process.env.HOME || "/root";
    const idlPath = [
        process.env.BET_TOKEN_IDL,
        join(process.cwd(), "skills", "idl", "bet_token_client.idl"),
        join(home, ".agents", "skills", "polybaskets-skills", "idl", "bet_token_client.idl"),
    ].filter(Boolean).find(p => existsSync(p));

    if (!idlPath) throw new Error("IDL not found");
    const idl = readFileSync(idlPath, "utf-8");
    const parser = await SailsIdlParser.new();
    sails = new Sails(parser);
    sails.parseIdl(idl);
    sails.setApi(api);
    sails.setProgramId(BET_TOKEN);
    log("✅ Sails ready:", idlPath);
}

async function init() {
    log("🔌 Connecting...");
    api = await GearApi.create({ providerAddress: RPC });
    const keyring = new Keyring({ type: "sr25519" });
    account = keyring.addFromUri(process.env.PRIVATE_KEY);
    log("✅ Wallet:", account.address);
    await initSails();
}

async function ensureVoucher() {
    try {
        const res = await fetch(`${VOUCHER_URL}/${hexAddress}`);
        const data = await res.json();
        if (data.voucherId) {
            voucherId = data.voucherId;
            log("🎫 Voucher:", voucherId);
            if (data.canTopUpNow === false) return;
        }
        const postRes = await fetch(VOUCHER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: hexAddress, programs: [BASKET_MARKET, BET_TOKEN, BET_LANE] })
        });
        const postData = await postRes.json();
        if (postData.voucherId) voucherId = postData.voucherId;
        log("🎫 Voucher set:", voucherId);
    } catch (err) {
        log("⚠️ Voucher error:", err.message);
    }
}

async function approve() {
    if (!voucherId || !sails) return false;
    try {
        const amount = String(20000000000000 + Math.floor(Math.random() * 99999));

        const tx = sails.services.BetToken.functions.Approve(BET_LANE, amount);
        tx.withAccount(account, { voucherId });
        tx.withGas(25000000000n);

        await new Promise((resolve, reject) => {
            // 15 second timeout per tx
            const timer = setTimeout(() => reject(new Error("timeout")), 15000);
            tx.signAndSend(account, ({ status }) => {
                if (status.isReady) log("📡 Ready");
                if (status.isBroadcast) log("📡 Broadcast");
                if (status.isInBlock) {
                    clearTimeout(timer);
                    approveCounter++;
                    log(`✅ #${approveCounter} inBlock`);
                    resolve(true);
                }
                if (status.isDropped || status.isInvalid || status.isError) {
                    clearTimeout(timer);
                    reject(new Error("tx failed: " + status.type));
                }
            }).catch(e => { clearTimeout(timer); reject(e); });
        });

        return true;
    } catch (err) {
        log("❌", String(err.message || err).slice(0, 100));
        return false;
    }
}

async function main() {
    await init();
    await ensureVoucher();

    if (!voucherId) {
        log("💥 No voucher — exiting");
        process.exit(1);
    }

    log("🚀 LOOP STARTED");
    let errors = 0;

    while (true) {
        try {
            if (approveCounter > 0 && approveCounter % 50 === 0) await ensureVoucher();
            const ok = await approve();
            if (ok) {
                errors = 0;
            } else {
                errors++;
                if (errors >= 5) {
                    await wait(2000);
                    await ensureVoucher();
                    errors = 0;
                }
            }
        } catch (err) {
            log("💥", err.message?.slice(0, 60));
            await wait(500);
        }
    }
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
