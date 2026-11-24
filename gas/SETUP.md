# คู่มือตั้งค่า Google Apps Script (แจ้งเตือนอีเมลอัตโนมัติ)

> **ข้อควรระวัง:** ยังไม่เปิดใช้งานจริงหรือส่งอีเมลไป `pongsak@smetaltech.co.th` จนกว่าพี่ต้นจะอนุมัติขั้นตอน Deploy แยก

## 1. สร้างโปรเจกต์ GAS ด้วยบัญชี `smetaltech027@gmail.com`

1. ลงชื่อเข้าใช้ https://script.google.com ด้วยบัญชี `smetaltech027@gmail.com`
2. สร้างโปรเจกต์ใหม่ชื่อ `Measuring Instrument Reminder`
3. คัดลอกไฟล์ `gas/Code.gs` และเปิดดูไฟล์ manifest ใน Project Settings เพื่อใส่ `gas/appsscript.json`

## 2. ตั้งค่า Script Properties (ห้ามใส่ Secret ในโค้ด)

ไปที่ **Project Settings → Script Properties** และเพิ่มค่าต่อไปนี้:

| Property | ตัวอย่างค่า | หมายเหตุ |
| --- | --- | --- |
| `WORKER_API_URL` | `https://measuring-instrument-api.<subdomain>.workers.dev` | URL จริงของ Cloudflare Worker |
| `GAS_REMINDER_SECRET` | `(คีย์สุ่ม >= 32 ตัวอักษร)` | ต้องตรงกับ secret ใน Cloudflare Worker |
| `RECIPIENT_EMAIL` | `pongsak@smetaltech.co.th` | อีเมลผู้รับสรุปรายวัน |
| `DRY_RUN_MODE` | `true` | ตั้งเป็น `true` ไว้ก่อนระหว่างทดสอบ; เปลี่ยนเป็น `false` เฉพาะเมื่อได้รับอนุมัติเปิดส่งจริง |

## 3. ทดสอบแบบ Dry Run และตรวจโควตา

1. เลือกฟังก์ชัน `runDailyExpiryReminderDryRun` แล้วกด **Run**
2. ตรวจสอบ Execution Log:
   - จะเห็น `remainingMailQuota` (โควตา MailApp รายวันของ Gmail; อ้างอิง https://developers.google.com/apps-script/guides/services/quotas)
   - จะเห็นจำนวนรายการที่เข้าเกณฑ์และตัวอย่าง Subject / Body โดย **ไม่ส่งอีเมลจริง** และไม่เขียนลงฐานข้อมูล

## 4. ตั้ง Trigger รายวัน (หลังได้รับอนุมัติ Deploy)

1. เปลี่ยน `DRY_RUN_MODE` เป็น `false`
2. ไปที่ **Triggers → Add Trigger**
   - Function: `runDailyExpiryReminder`
   - Event source: `Time-driven`
   - Type: `Day timer`
   - Time of day: `7am to 8am` (เวลาไทย `Asia/Bangkok`; เวลาจริงอยู่ในช่วงชั่วโมงที่เลือก)
3. ตรวจสอบสถานะการส่งได้ทั้งจาก Execution Log ของ GAS และหน้า **ประวัติอีเมลเตือน** ใน Admin Dashboard
