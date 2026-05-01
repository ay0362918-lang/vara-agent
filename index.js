import { setTimeout as wait } from "timers/promises";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

if (!process.env.PRIVATE_KEY) { console.error("💥 PRIVATE_KEY not set"); process.exit(1); }

const execFileAsync = promisify(execFile);
console.log("🔥 HY4 CLI SPAMMER");

const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const hexAddress = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

let voucherId;
let approveCounter = 0;

function log(...args) { console.log(`[${new Date().toLocaleTimeString()}]`, ...args); }

const home = process.env.HOME || "/root";
const IDL_PATH = [
    process.env.BET_TOKEN_IDL,
    join(process.cwd(), "skills", "idl", "bet_token_client.idl"),
    join(home, ".agents", "skills", "polybaskets-skills", "idl", "bet_token_client.idl"),
].filter(Boolean).find(p => existsSync(p));

const BASKET_IDL_PATH = [
    process.env.POLYBASKETS_IDL,
    join(process.cwd(), "skills", "idl", "polymarket-mirror.idl"),
    join(home, ".agents", "skills", "polybaskets-skills", "idl", "polymarket-mirror.idl"),
].filter(Boolean).find(p => existsSync(p));

const SIGNER = process.env.PRIVATE_KEY.trim().includes(" ")
    ? ["--mnemonic", process.env.PRIVATE_KEY.trim()]
    : ["--seed", process.env.PRIVATE_KEY.trim()];

async function ensureVoucher() {
    try {
        const res = await fetch(`${VOUCHER_URL}/${hexAddress}`);
        const data = await res.json();
        if (data.voucherId) {
            voucherId = data.voucherId;
            if (data.canTopUpNow === false) return;
        }
        const postRes = await fetch(VOUCHER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: hexAddress, programs: [BASKET_MARKET, BET_TOKEN, BET_LANE] })
        });
        const postData = await postRes.json();
        if (postData.voucherId) voucherId = postData.voucherId;
    } catch (err) { log("⚠️ Voucher error:", err.message); }
}

async function approve() {
    if (!voucherId || !IDL_PATH) return false;
    try {
        const amount = String(20000000000000 + Math.floor(Math.random() * 9999));
        const { stdout } = await execFileAsync("vara-wallet", [
            ...SIGNER,
            "call", BET_TOKEN, "BetToken/Approve",
            "--args", `["${BET_LANE}", "${amount}"]`,
            "--voucher", voucherId,
            "--gas-limit", "25000000000",
            "--idl", IDL_PATH
        ], { maxBuffer: 1024 * 1024 * 4, timeout: 120000 });

        const parsed = JSON.parse(stdout?.trim() || "{}");
        if (parsed && "result" in parsed) {
            approveCounter++;
            log(`✅ #${approveCounter}`);
            return true;
        }
        return false;
    } catch (err) {
        log("❌", String(err.message || err).slice(0, 60));
        return false;
    }
}

async function main() {
    if (!IDL_PATH) { console.error("💥 IDL not found"); process.exit(1); }
    log("🔌 IDL:", IDL_PATH);
    await execFileAsync("vara-wallet", ["config", "set", "network", "mainnet"], { timeout: 30000 }).catch(() => {});
    await ensureVoucher();

    if (BASKET_IDL_PATH) {
        await execFileAsync("vara-wallet", [
            ...SIGNER, "call", BASKET_MARKET, "BasketMarket/RegisterAgent",
            "--args", '["hy4"]', "--voucher", voucherId,
            "--gas-limit", "15000000000", "--idl", BASKET_IDL_PATH
        ], { timeout: 120000 }).catch(() => {});
    }

    log("🚀 LOOP STARTED");
    let errors = 0;
    while (true) {
        try {
            if (approveCounter > 0 && approveCounter % 50 === 0) await ensureVoucher();
            const ok = await approve();
            if (ok) { errors = 0; }
            else {
                errors++;
                if (errors >= 5) { await wait(2000); await ensureVoucher(); errors = 0; }
            }
        } catch (err) { log("💥", err.message?.slice(0, 60)); await wait(500); }
    }
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
