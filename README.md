# ระบบทะเบียนเครื่องมือวัด (Measuring Instrument System — RG-PD-001)

เว็บแอปพลิเคชันบริหารจัดการทะเบียนเครื่องมือวัด บริษัท เอส เมททอล เทค จำกัด รองรับการใช้งานทั้งมือถือ แท็บเล็ต และคอมพิวเตอร์

## ภาพรวมสถาปัตยกรรม

| ชั้นระบบ | หน้าที่ |
| --- | --- |
| **Frontend (React + Vite + TypeScript)** | เผยแพร่บน GitHub Pages (HTTPS) — หน้าสแกน QR, หน้ารายละเอียดรายเครื่อง (`/?instrument={token}`), หน้า Admin Login และ Admin Dashboard |
| **Supabase Postgres + Auth + RLS** | จัดเก็บทะเบียนเครื่องมือ (`instruments`), บัญชี Admin (`app_admins`), ประวัติการเปลี่ยนวันที่ (`instrument_date_history`) และบันทึกการแจ้งเตือนอีเมล (`reminder_logs`) |
| **Cloudflare Worker + Private R2** | API อ่านข้อมูลรายเครื่องจาก QR token, ส่งภาพจาก Private R2 Bucket, ตรวจสิทธิ์ Admin JWT ก่อนอัปโหลดรูป และ API เฉพาะกิจสำหรับ GAS |
| **Google Apps Script (`gas/`)** | ทำงานวันละ 1 รอบช่วงเช้า ส่งอีเมลสรุปเครื่องมือที่เหลือ 7 วัน (และชดเชย 1–6 วัน) ไป `pongsak@smetaltech.co.th` |

## การพัฒนาและทดสอบแบบ Local

```bash
# 1. ติดตั้งแพ็กเกจ (ถ้ายังไม่ได้ติดตั้ง)
npm install
npm --prefix worker install

# 2. สร้างไฟล์ Template Excel เปล่า (RG-PD-001) และรายงาน Dry-Run Import (อยู่ใน reports/ ที่ gitignored)
npm run excel:prepare
npm run import:dry-run

# 3. ตรวจสอบ TypeScript, ทดสอบ Unit/Integration Tests และ Build
npm run typecheck
npm --prefix worker run typecheck
npm test
npm run build

# 4. รัน Dev Server ในเครื่อง
cp .env.example .env
npm run dev
```

## วิธีใช้งานสำหรับ Admin

1. **เพิ่ม / แก้ไขเครื่องมือวัด:** เข้าสู่ระบบที่ `/?view=admin` ด้วยบัญชี `smetaltech027@gmail.com` → กด **เพิ่มเครื่องมือวัด** หรือคลิกปุ่ม **แก้** บนรายการที่ต้องการ การเปลี่ยนวันที่ Compare / Calibration / Expire จะถูกบันทึกประวัติค่าก่อนและหลังอัตโนมัติในฐานข้อมูล
2. **พิมพ์ฉลาก QR:**
   - **รายเครื่อง:** กดปุ่ม **QR** ในตารางหรือในหน้าต่างรายละเอียดเพื่อดาวน์โหลดไฟล์ PNG พร้อมรหัส `MI-xxx` และชื่อเครื่อง
   - **รวมแผ่น A4:** กดปุ่ม **พิมพ์ QR รวม A4** เลือกเครื่องที่ต้องการ และตั้งค่าหน้ากระดาษเครื่องพิมพ์เป็น **A4 แนวตั้ง, Scale 100% (Actual Size)**
   - **สำคัญ:** ต้องล็อก `VITE_PUBLIC_BASE_URL` เป็นโดเมน Production ถาวรก่อนพิมพ์ฉลากติดเครื่องจริง
3. **Export Excel ฉบับเต็ม (`RG-PD-001`):** กดปุ่ม **Export Excel ทั้งหมด** ระบบจะดึงข้อมูลทุกรายการเรียงตามลำดับทะเบียน (ไม่เปลี่ยนตามตัวกรองบนจอ) เติมลงแบบฟอร์ม `RG-PD-001` และขยายหน้าอัตโนมัติหากเกิน 74 รายการโดยไม่ทับช่องลงชื่อ
4. **การจับคู่รูปเครื่องมือ 74 รายการในภายหลัง:** วางโฟลเดอร์รูปไว้ที่ `./photos` แล้วรัน `npm run photos:match` เพื่อสร้างตารางจับคู่ใน `reports/photo-matching-report.md` ให้ตรวจสอบและยืนยันรายการที่กำกวมก่อนอัปโหลดจริง

## การสำรองข้อมูลและการตรวจอีเมล

- **สำรองข้อมูล:** ใช้ปุ่ม Export Excel เป็นประจำ และตั้งค่าสำรองข้อมูล Postgres ของ Supabase ก่อนทำ Migration หรือ Import ข้อมูลจำนวนมาก (ห้าม commit ไฟล์ `Book1.xlsx`, รูปจริง หรือไฟล์ `.env` ขึ้น public repository)
- **ตรวจสอบอีเมลแจ้งเตือน:** เปิดดูได้จากปุ่ม **ประวัติอีเมลเตือน** ใน Admin Dashboard และ Execution Log ของ Google Apps Script (รายละเอียดใน [gas/SETUP.md](./gas/SETUP.md))

## สิ่งที่ยังต้องขออนุมัติแยกก่อนใช้งานจริง (Production Deploy)

- สร้าง/ตั้งค่าโปรเจกต์จริงบน Supabase, Cloudflare (Worker + R2), GitHub Pages และ Google Apps Script ด้วยบัญชี `smetaltech027@gmail.com`
- รัน SQL Migrations (`supabase/migrations/202611240001_initial_schema.sql`, `202611240002_rls_and_admin_policies.sql`), ทดสอบ `supabase/verify_rls.sql`, และเพิ่มบัญชี Admin (`supabase/seed_admin_template.sql`)
- รันนำเข้าข้อมูลจริง 74 รายการ (`node scripts/import-to-supabase.mjs --confirm-live-import`)
- ทดสอบ Dry Run บน GAS ก่อนเปลี่ยน `DRY_RUN_MODE` เป็น `false` และเปิด Trigger รายวัน
- ทดสอบเปิดเว็บและ Modal บนอุปกรณ์ iPhone (Safari / Chrome) จริง
