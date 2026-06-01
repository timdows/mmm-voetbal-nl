const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );

  console.log("Navigating...");
  await page.goto("https://www.voetbal.nl/team/T707686914/uitslagen", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  const html = await page.content();
  const $ = cheerio.load(html);

  console.log("Title:", await page.title());
  console.log("Has 'Bilt De FC':", html.includes("Bilt De FC"));
  console.log("Has .table:", $(".table").length);
  console.log("Has a.row:", $("a.row").length);
  console.log("Has onderhoudsmodus:", html.includes("onderhoudsmodus"));
  console.log("Has challenge:", html.includes("challenge") || html.includes("Checking your browser"));

  // Show first a.row or first 500 chars of body text
  const firstRow = $("a.row").first().text().trim();
  if (firstRow) {
    console.log("First row text:", firstRow.substring(0, 200));
  } else {
    console.log("Body snippet:", $("body").text().substring(0, 500));
  }

  await browser.close();
})();
