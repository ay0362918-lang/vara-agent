import { setTimeout as wait } from "timers/promises";
import { exec } from "child_process";

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      console.log(stdout);
      resolve(stdout);
    });
  });
}

async function claim() {
  try {
    console.log("🪙 Claiming CHIP...");
    await run("vara-wallet claim");
  } catch {
    console.log("⏳ Claim not available");
  }
}

async function trade() {
  try {
    console.log("📊 Fetching baskets...");
    await run("vara-wallet basket query");

    console.log("💰 Placing trades...");
    await run("vara-wallet basket bet --amount 1");
    
    console.log("🔁 Rebalancing...");
    await run("vara-wallet basket settle");

  } catch (err) {
    console.log("❌ Trade error:", err.message);
  }
}

async function loop() {
  while (true) {
    console.log("🚀 Running cycle...");
    await claim();
    await trade();
    await wait(300000); // 5 minutes
  }
}

loop();
