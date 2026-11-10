# ⚡ Watchvest (StockAnalysis Pro Watchlist)

ระบบติดตามและวิเคราะห์ข้อมูลสินทรัพย์การลงทุน ออกแบบและถอดแบบการทำงานเลียนแบบ [StockAnalysis.com/watchlist/](https://stockanalysis.com/watchlist/) อย่างเต็มรูปแบบ รองรับหุ้นสหรัฐฯ (US Stocks), กองทุนรวม ETF, หุ้นไทย (SET BKK), หุ้นฮ่องกง (HKEX) และคริปโทเคอร์เรนซี (Crypto) พร้อมการคำนวณดัชนีทางเทคนิค Multi-Timeframe RSI (Daily, Weekly, Monthly) ตามมาตรฐาน TradingView

🚀 **Official Live Web Application:** [https://watchvest.pages.dev/](https://watchvest.pages.dev/)  
🌐 **Repository:** [https://github.com/Wadcharid/watchvest](https://github.com/Wadcharid/watchvest)  
☁️ **Serverless Architecture:** ทำงานบน Cloudflare Pages Functions (`functions/api/`) ประมวลผลราคา Real-Time แบบ Serverless Edge ไม่มีปัญหา CORS ไม่ต้องพึ่งพาบอท Cron

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
   * `/api/quote?symbols={symbols}`: ดึงราคาแบบสดใหม่ Real-Time Tick-by-Tick, คำนวณ Wilder's 14 RSI (Daily, Weekly, Monthly) และ TTM Dividend Yield จาก Edge โดยตรง
   * `/api/search?q={query}`: ค้นหาหุ้น กองทุน และสินทรัพย์การลงทุน
   * **Auto-Refresh Engine:** รีเฟรชราคาอัตโนมัติทุก 30 วินาทีขณะเปิดดูหน้าจอ และอัปเดตทันทีเมื่อสลับแท็บกลับมา

3. **มาตรฐานการคำนวณที่แม่นยำ:**
   * **Wilder's RSI (14 งวด):** อ้างอิงราคาปิดจริงในตลาด (Split-Adjusted Only) ตรงตามมาตรฐาน TradingView และ StockAnalysis (แก้ปัญหาภาพลวงตา RSI พุ่งสูงในกองทุนปันผลสูง เช่น SPYI, IAUI)
   * **TTM Dividend Yield:** คำนวณจากเงินปันผลสดจริงที่จ่ายในรอบ 12 เดือนย้อนหลัง หารด้วยราคาตลาดปัจจุบัน
   * **แสดงวันและเวลาไทย:** แสดงผลเวลาในรูปแบบ `ICT UTC+7` ของประเทศไทย

4. **การปรับแต่งและสไตล์ (UI/UX):**
   * รองรับทั้ง **🌙 Dark Mode** (เนวี่บลูเข้มสไตล์ StockAnalysis) และ **☀️ Light Mode**
   * ระบบ **Backup & Share**: ดาวน์โหลดไฟล์ Watchlist JSON หรือแชร์ URL Hash (`#symbols=NVDA,MSFT`) ให้เปิดดูข้ามเครื่องได้ทันที
   * มีสรุปตัวเลขสถิติ (Total Assets, Gainers, Losers, RSI Oversold, RSI Overbought)
   * มีปุ่มลบสินทรัพย์ออกจากพอร์ต และปุ่มเปิดหน้ารายละเอียดบน [StockAnalysis.com](https://stockanalysis.com/) โดยตรง
