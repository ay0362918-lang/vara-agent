import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { setTimeout as wait } from "timers/promises";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const execFileAsync = promisify(execFile);

console.log("🔥 HY4 ULTRA-FAST SPAMMER - PARALLEL MODE");

const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const hexAddress = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";
const AGENT_NAME = process.env.AGENT_NAME || "hy4";

// CONFIGURATION
const CONCURRENCY = 5; // Number of parallel transactions
const GAS_LIMIT = "25000000000";

let voucherId;
let approveCounter = 0;

function log(...args ) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

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

async function registerAgent() {
    if (!voucherId || !BASKET_IDL_PATH) return;
    try {
        await execFileAsync("vara-wallet", ["config", "set", "network", "mainnet"], { timeout: 30000 });
        await execFileAsync("vara-wallet", [
            ...SIGNER,
            "call", BASKET_MARKET,
            "BasketMarket/RegisterAgent",
            "--args", JSON.stringify([AGENT_NAME]),
            "--voucher", voucherId,
            "--gas-limit", "15000000000",
            "--idl", BASKET_IDL_PATH
        ], { maxBuffer: 1024 * 1024 * 4, timeout: 120000 });
        log("✅ Agent registered");
    } catch (err) {
        log("ℹ️ Register note (ok if already registered)");
    }
}

async function approve(nonce) {
    if (!voucherId || !IDL_PATH) return false;
    try {
        const amount = 20000000000000 + Math.floor(Math.random() * 9999);
        const args = [
            ...SIGNER,
            "call", BET_TOKEN,
            "BetToken/Approve",
            "--args", `["${BET_LANE}", ${amount}]`,
            "--voucher", voucherId,
            "--gas-limit", GAS_LIMIT,
            "--idl", IDL_PATH
        ];

        // Add nonce if provided
        if (nonce !== undefined) {
            args.push("--nonce", nonce.toString());
        }

        const { stdout } = await execFileAsync("vara-wallet", args, {
            maxBuffer: 1024 * 1024 * 4,
            timeout: 120000
        });

        const parsed = JSON.parse(stdout?.trim() || "{}");
        if (parsed?.result === true || parsed?.status === "Success") {
            approveCounter++;
            log(`✅ #${approveCounter} (Nonce: ${nonce})`);
            return true;
        }
        return false;
    } catch (err) {
        log("❌", String(err.message || err).slice(0, 60));
        return false;
    }
}

async function getInitialNonce() {
    try {
        const { stdout } = await execFileAsync("vara-wallet", ["balance", "--account", hexAddress], { timeout: 30000 });
        const data = JSON.parse(stdout);
        return parseInt(data.nonce);
    } catch (err) {
        log("⚠️ Failed to get nonce, falling back to auto");
        return undefined;
    }
}

async function main() {
    if (!IDL_PATH) {
        console.error("💥 FATAL: bet_token_client.idl not found.");
        process.exit(1);
    }

    await execFileAsync("vara-wallet", ["config", "set", "network", "mainnet"], { timeout: 30000 }).catch(() => {});
    await ensureVoucher();
    await registerAgent();

    let currentNonce = await getInitialNonce();
    log(`🚀 STARTING WITH NONCE: ${currentNonce}`);

    const workers = Array.from({ length: CONCURRENCY }, async (_, i) => {
        while (true) {
            const myNonce = currentNonce !== undefined ? currentNonce++ : undefined;
            const ok = await approve(myNonce);
            if (!ok) {
                // If failed, wait a bit and re-sync nonce
                await wait(1000);
                const syncedNonce = await getInitialNonce();
                if (syncedNonce !== undefined) currentNonce = Math.max(currentNonce, syncedNonce);
            }
            // Small delay to prevent overwhelming the RPC
            await wait(100);
        }
    });

    await Promise.all(workers);
}

main().catch(err => {
    console.error("💥 Fatal:", err);
    process.exit(1);
});
