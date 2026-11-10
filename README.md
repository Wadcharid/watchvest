# ⚡ Watchvest (StockAnalysis Pro Watchlist)

ระบบติดตามและวิเคราะห์ข้อมูลสินทรัพย์การลงทุน ออกแบบและถอดแบบการทำงานเลียนแบบ [StockAnalysis.com/watchlist/](https://stockanalysis.com/watchlist/) อย่างเต็มรูปแบบ รองรับหุ้นสหรัฐฯ (US Stocks), กองทุนรวม ETF, หุ้นไทย (SET BKK), หุ้นฮ่องกง (HKEX) และคริปโทเคอร์เรนซี (Crypto) พร้อมการคำนวณดัชนีทางเทคนิค Multi-Timeframe RSI (Daily, Weekly, Monthly) ตามมาตรฐาน TradingView

🌐 **Repository:** [https://github.com/Wadcharid/watchvest](https://github.com/Wadcharid/watchvest)  
🚀 **GitHub Pages URL:** [https://wadcharid.github.io/watchvest/](https://wadcharid.github.io/watchvest/)  
☁️ **Cloudflare Pages:** รองรับ Edge Serverless Functions ในโฟลเดอร์ `functions/api/` เพื่อการดึงข้อมูลสดทันทีแบบ Real-Time ไม่มีปัญหา CORS

---

## ✨ ฟีเจอร์หลัก (Key Features)

1. **ถอดแบบหน้าตาและการทำงานสไตล์ StockAnalysis.com:**
   * **Multiple Watchlists (รองรับหลายพอร์ตพร้อมกัน):** สลับดูระหว่าง "พอร์ตหลัก", "หุ้นเติบโต", "หุ้น & กองทุนปันผล" หรือกดปุ่ม `+ สร้าง List ใหม่`, เปลี่ยนชื่อ, คัดลอก, และลบได้ตามต้องการ
   * **StockAnalysis Views Switcher:** สลับมุมมองตารางข้อมูลได้ 4 โหมด:
     * 📊 **Overview:** ราคาล่าสุด, % เปลี่ยนแปลง 24h, Market Cap, P/E Ratio, Dividend Yield, 52W High (%), 52W Low (%)
     * 📈 **Technical (RSI):** Daily RSI (14), Weekly RSI (14), Monthly RSI (14), ป้ายสถานะโซน RSI (Oversold / Neutral / Overbought)
     * 💰 **Dividends:** เน้นดูอัตราเงินปันผลตอบแทน (TTM Cash Distribution Yield), P/E Ratio
     * 🌐 **All Columns:** รวมทุกคอลัมน์สำคัญไว้ในตารางกว้างแบบเลื่อนได้ (พร้อมตรึงคอลัมน์ Symbol ไว้)
   * **Instant Search & Autocomplete:** ค้นหาและพิมพ์ชื่อหุ้นเพื่อเพิ่มเข้า Watchlist ได้ทันที พร้อมระบบแนะนำอัตโนมัติ

2. **ระบบดึงข้อมูล Real-time ผ่าน Cloudflare Pages Functions (`functions/api/`):**
   * `/api/search?q={query}`: ค้นหาหุ้น กองทุน และสินทรัพย์การลงทุน
   * `/api/quote?symbols={symbols}`: ดึงราคาแบบสดใหม่, คำนวณ Wilder's 14 RSI (Daily, Weekly, Monthly) และ TTM Dividend Yield จาก Edge แบบ Real-Time ไม่มีติด CORS
   * **ระบบสำรอง (Fallback):** สามารถโหลดข้อมูลจาก `data/stocks.json` ได้อัตโนมัติหากรันในสภาพแวดล้อม Static ทั่วไป

3. **มาตรฐานการคำนวณที่แม่นยำ:**
   * **Wilder's RSI (14 งวด):** อ้างอิงราคาปิดจริงในตลาด (Split-Adjusted Only) ตรงตามมาตรฐาน TradingView และ StockAnalysis (แก้ปัญหาภาพลวงตา RSI พุ่งสูงในกองทุนปันผลสูง เช่น SPYI, IAUI)
   * **TTM Dividend Yield:** คำนวณจากเงินปันผลสดจริงที่จ่ายในรอบ 12 เดือนย้อนหลัง หารด้วยราคาตลาดปัจจุบัน
   * **แสดงวันและเวลาไทย:** แสดงผลเวลาในรูปแบบ `ICT UTC+7` ของประเทศไทย

4. **การปรับแต่งและสไตล์ (UI/UX):**
   * รองรับทั้ง **🌙 Dark Mode** (เนวี่บลูเข้มสไตล์ StockAnalysis) และ **☀️ Light Mode**
   * มีสรุปตัวเลขสถิติ (Total Assets, Gainers, Losers, RSI Oversold, RSI Overbought)
   * มีปุ่มลบสินทรัพย์ออกจากพอร์ต และปุ่มเปิดหน้ารายละเอียดบน [StockAnalysis.com](https://stockanalysis.com/) โดยตรง

---

## ☁️ วิธีเชื่อมต่อเข้ากับ Cloudflare Pages (แนะนำ)

1. เข้าสู่แดชบอร์ดของ [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. ไปที่เมนู **Workers & Pages** > กด **Create Application** > เลือกแท็บ **Pages**
3. เลือก **Connect to Git** แล้วเลือก Repository: `Wadcharid/watchvest`
4. ตั้งค่า Build:
   * **Framework preset:** None
   * **Build command:** *(เว้นว่างไว้)*
   * **Build output directory:** `/` *(หรือ root)*
5. กด **Save and Deploy**
6. เว็บไซต์ของคุณจะออนไลน์ทันทีที่โดเมน Cloudflare Pages (เช่น `https://watchvest.pages.dev/`) พร้อมใช้งาน Edge API `/api/quote` สดใหม่ตลอดเวลา

---

## 🤖 ระบบสำรอง GitHub Actions (อัปเดตอัตโนมัติ)

ไฟล์ `.github/workflows/update_data.yml` จะคอยรัน Python คำนวณข้อมูลอัตโนมัติทุกๆ 3 ชั่วโมงตลอด 24 ชั่วโมง และอัปเดตไฟล์ `data/stocks.json` เพื่อให้ข้อมูลพร้อมใช้งานอยู่เสมอ
