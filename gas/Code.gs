/**
 * Measuring Instrument System — Daily Expiry Email Reminder (Google Apps Script)
 * Account owner: smetaltech027@gmail.com
 * Recipient: pongsak@smetaltech.co.th (configured via Script Properties)
 *
 * Script Properties required:
 * - WORKER_API_URL      (e.g. https://measuring-instrument-api.your-subdomain.workers.dev)
 * - GAS_REMINDER_SECRET (shared secret matching Cloudflare Worker secret; NEVER hardcode)
 * - RECIPIENT_EMAIL     (default: pongsak@smetaltech.co.th)
 * - DRY_RUN_MODE        ("true" by default; set to "false" ONLY after approval)
 */

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var workerUrl = (props.getProperty('WORKER_API_URL') || '').trim().replace(/\/+$/, '');
  var secret = (props.getProperty('GAS_REMINDER_SECRET') || '').trim();
  var recipient = (props.getProperty('RECIPIENT_EMAIL') || 'pongsak@smetaltech.co.th').trim();
  var dryRunProp = (props.getProperty('DRY_RUN_MODE') || 'true').trim().toLowerCase();

  if (!workerUrl) {
    throw new Error('Missing Script Property: WORKER_API_URL');
  }
  if (!secret) {
    throw new Error('Missing Script Property: GAS_REMINDER_SECRET');
  }

  return {
    workerUrl: workerUrl,
    secret: secret,
    recipient: recipient,
    dryRun: dryRunProp !== 'false'
  };
}

/**
 * Safe dry-run entrypoint: queries due instruments without locking DB or sending any email.
 * Optionally pass todayOverride ("YYYY-MM-DD") to test -7, -6, 0, and expired scenarios.
 */
function runDailyExpiryReminderDryRun(todayOverride) {
  return executeReminderJob_({ forceDryRun: true, todayOverride: todayOverride || null });
}

/**
 * Send a real sample email to smetaltech027@gmail.com (active account) using simulated date
 * "2026-11-29" (7 days before MI-028 expires on 2026-12-06) WITHOUT writing reminder_logs.
 */
function testSendSampleEmailToSelf() {
  var config = getConfig_();
  var targetEmail = Session.getActiveUser().getEmail() || 'smetaltech027@gmail.com';
  return sendSampleEmail_(config, targetEmail, '2026-11-29');
}

/**
 * Send a real sample email to configured RECIPIENT_EMAIL (pongsak@smetaltech.co.th)
 * using simulated date "2026-11-29" WITHOUT writing reminder_logs.
 */
function testSendSampleEmailToRecipient() {
  var config = getConfig_();
  return sendSampleEmail_(config, config.recipient, '2026-11-29');
}

function sendSampleEmail_(config, toEmail, simulatedBangkokDate) {
  var remainingQuota = MailApp.getRemainingDailyQuota();
  if (remainingQuota < 1) {
    throw new Error('Gmail MailApp daily quota exhausted (remaining=' + remainingQuota + ').');
  }
  var prepared = callWorkerJson_(
    config.workerUrl + '/api/gas/reminders/prepare',
    config.secret,
    { dryRun: true, todayOverride: simulatedBangkokDate }
  );
  var due = prepared.due || [];
  if (due.length === 0) {
    throw new Error('No due items found for simulated date ' + simulatedBangkokDate);
  }
  var content = buildReminderEmailContent_(due, prepared.todayBangkok);
  var testSubject = '[TEST ตัวอย่าง] ' + content.subject;
  MailApp.sendEmail({
    to: toEmail,
    name: 'Measuring Instrument System',
    subject: testSubject,
    body:
      '*** อีเมลนี้เป็นการทดสอบรูปแบบการแจ้งเตือน (จำลองวันที่ ' +
      formatIsoToDmy_(simulatedBangkokDate) +
      ') ***\n\n' +
      content.plainBody,
    htmlBody:
      '<p style="background:#fef5e7;border:1px solid #f0cf99;color:#8c5306;padding:10px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;">' +
      '<strong>อีเมลทดสอบระบบ (Test Sample)</strong> — จำลองวันตรวจที่ ' +
      escapeHtml_(formatIsoToDmy_(simulatedBangkokDate)) +
      ' (ไม่กระทบสถานะแจ้งเตือนจริงในฐานข้อมูล)</p>' +
      content.htmlBody
  });
  Logger.log(
    '[TEST_EMAIL_SENT] Sent sample email to ' +
      toEmail +
      ' | items=' +
      due.length +
      ' | remainingQuota=' +
      MailApp.getRemainingDailyQuota()
  );
  return { ok: true, to: toEmail, itemCount: due.length, subject: testSubject };
}

/**
 * Install daily morning trigger (07:00-08:00 Asia/Bangkok) cleanly without duplicates.
 * Run once after setting DRY_RUN_MODE="false" and approving live alerts.
 */
function setupDailyMorningTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'runDailyExpiryReminder') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('runDailyExpiryReminder')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .inTimezone('Asia/Bangkok')
    .create();
  Logger.log('[OK] Installed daily morning trigger for runDailyExpiryReminder (07:00-08:00 Asia/Bangkok).');
}

/**
 * Daily time-driven trigger entrypoint (morning, Asia/Bangkok).
 * Respects DRY_RUN_MODE Script Property until explicitly enabled.
 */
function runDailyExpiryReminder() {
  return executeReminderJob_({ forceDryRun: false, todayOverride: null });
}

function executeReminderJob_(options) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('[SKIP] Another reminder execution is currently running (ScriptLock active).');
    return { skipped: true, reason: 'lock_busy' };
  }

  try {
    var config = getConfig_();
    var dryRun = Boolean(options.forceDryRun || config.dryRun);

    var remainingQuota = MailApp.getRemainingDailyQuota();
    Logger.log(
      '[INFO] Starting reminder job | dryRun=' +
        dryRun +
        ' | recipient=' +
        config.recipient +
        ' | remainingMailQuota=' +
        remainingQuota
    );

    if (!dryRun && remainingQuota < 1) {
      throw new Error('Gmail MailApp daily quota exhausted (remaining=' + remainingQuota + ').');
    }

    var preparePayload = { dryRun: dryRun };
    if (options.todayOverride) {
      preparePayload.todayOverride = options.todayOverride;
    }

    var prepared = callWorkerJson_(
      config.workerUrl + '/api/gas/reminders/prepare',
      config.secret,
      preparePayload
    );

    var due = prepared.due || [];
    Logger.log(
      '[INFO] Evaluated for Bangkok date ' +
        prepared.todayBangkok +
        ' | due=' +
        due.length +
        ' | skippedAlreadySent=' +
        (prepared.skippedAlreadySent || 0) +
        ' | skippedLocked=' +
        (prepared.skippedLocked || 0) +
        ' | manualReviewRequired=' +
        ((prepared.manualReviewRequired || []).length)
    );

    if ((prepared.manualReviewRequired || []).length > 0) {
      Logger.log(
        '[WARN] Items exceeding max retry attempts (require Admin check): ' +
          JSON.stringify(prepared.manualReviewRequired)
      );
    }

    if (due.length === 0) {
      Logger.log('[INFO] No instruments due for reminder today.');
      return { ok: true, dryRun: dryRun, sentCount: 0, todayBangkok: prepared.todayBangkok };
    }

    var emailContent = buildReminderEmailContent_(due, prepared.todayBangkok);

    if (dryRun) {
      Logger.log('[DRY_RUN] Email NOT sent. Preview Subject: ' + emailContent.subject);
      Logger.log('[DRY_RUN] Preview Body:\n' + emailContent.plainBody);
      return {
        ok: true,
        dryRun: true,
        wouldSendCount: due.length,
        subject: emailContent.subject,
        todayBangkok: prepared.todayBangkok
      };
    }

    // Live send: wrap MailApp.sendEmail and report result back to Worker
    var sendError = null;
    try {
      MailApp.sendEmail({
        to: config.recipient,
        name: 'Measuring Instrument System',
        subject: emailContent.subject,
        body: emailContent.plainBody,
        htmlBody: emailContent.htmlBody
      });
    } catch (mailErr) {
      sendError = String(mailErr && mailErr.message ? mailErr.message : mailErr);
    }

    var results = due.map(function (item) {
      return {
        instrument_id: item.instrument_id,
        expiry_date: item.expiry_date,
        status: sendError ? 'failed' : 'sent',
        error_summary: sendError ? sendError.slice(0, 450) : undefined
      };
    });

    var reportOk = reportOutcomeWithRetry_(config, results);

    if (sendError) {
      throw new Error('MailApp.sendEmail failed: ' + sendError);
    }
    if (!reportOk) {
      // Edge case documented in Plan Section 7: email sent, but callback failed.
      Logger.log(
        '[CRITICAL_MANUAL_CHECK] Email WAS sent to ' +
          config.recipient +
          ' for ' +
          due.length +
          ' items, but recording sent_at back to Worker failed after retries. Check reminder_logs!'
      );
      return { ok: false, emailSent: true, reportRecorded: false, count: due.length };
    }

    Logger.log('[SUCCESS] Sent summary email for ' + due.length + ' instruments and recorded sent_at.');
    return { ok: true, dryRun: false, sentCount: due.length, todayBangkok: prepared.todayBangkok };
  } finally {
    lock.releaseLock();
  }
}

function reportOutcomeWithRetry_(config, results) {
  var maxRetries = 3;
  for (var attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      callWorkerJson_(config.workerUrl + '/api/gas/reminders/report', config.secret, {
        results: results
      });
      return true;
    } catch (err) {
      Logger.log(
        '[WARN] Report attempt ' +
          attempt +
          '/' +
          maxRetries +
          ' failed: ' +
          String(err && err.message ? err.message : err)
      );
      if (attempt < maxRetries) {
        Utilities.sleep(attempt * 2000);
      }
    }
  }
  return false;
}

function callWorkerJson_(url, secret, payload) {
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'X-Reminder-Secret': secret
    },
    payload: JSON.stringify(payload)
  });

  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Worker API HTTP ' + code + ': ' + text.slice(0, 300));
  }
  return JSON.parse(text);
}

function formatIsoToDmy_(iso) {
  var parts = String(iso || '').split('-');
  if (parts.length !== 3) return iso;
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildReminderEmailContent_(dueItems, todayBangkok) {
  var subject =
    '[แจ้งเตือนเครื่องมือวัด] ใกล้ครบกำหนดสอบเทียบ ' +
    dueItems.length +
    ' รายการ (' +
    formatIsoToDmy_(todayBangkok) +
    ')';

  var plainLines = [
    'เรียนผู้เกี่ยวข้อง,',
    '',
    'ระบบทะเบียนเครื่องมือวัด (RG-PD-001) บริษัท เอส เมททอล เทค จำกัด ขอแจ้งรายการเครื่องมือวัดที่ใกล้ครบกำหนดวันหมดอายุ (ประจำวันที่ ' +
      formatIsoToDmy_(todayBangkok) +
      '):',
    ''
  ];

  var htmlRows = [];
  for (var i = 0; i < dueItems.length; i += 1) {
    var item = dueItems[i];
    var note = item.reminder_type === 'catch_up' ? ' (แจ้งเตือนชดเชย)' : '';
    var line =
      (i + 1) +
      '. [' +
      item.instrument_code +
      '] ' +
      item.name +
      ' | สถานที่: ' +
      (item.location || 'ไม่ระบุ') +
      ' | หมดอายุ: ' +
      formatIsoToDmy_(item.expiry_date) +
      ' (เหลือ ' +
      item.days_remaining +
      ' วัน)' +
      note;
    plainLines.push(line);

    htmlRows.push(
      '<tr>' +
        '<td style="padding:8px;border:1px solid #d3e0e6;font-family:monospace;font-weight:600;">' +
        escapeHtml_(item.instrument_code) +
        '</td>' +
        '<td style="padding:8px;border:1px solid #d3e0e6;">' +
        escapeHtml_(item.name) +
        '</td>' +
        '<td style="padding:8px;border:1px solid #d3e0e6;">' +
        escapeHtml_(item.location || 'ไม่ระบุ') +
        '</td>' +
        '<td style="padding:8px;border:1px solid #d3e0e6;font-family:monospace;">' +
        escapeHtml_(formatIsoToDmy_(item.expiry_date)) +
        '</td>' +
        '<td style="padding:8px;border:1px solid #d3e0e6;color:#8c5306;font-weight:600;">เหลือ ' +
        item.days_remaining +
        ' วัน' +
        escapeHtml_(note) +
        '</td>' +
        '</tr>'
    );
  }

  plainLines.push('');
  plainLines.push('อีเมลนี้ส่งอัตโนมัติจากระบบทะเบียนเครื่องมือวัด (ส่ง 1 ครั้งต่อรอบวันหมดอายุ)');

  var htmlBody =
    '<div style="font-family:sans-serif;color:#173447;max-width:720px;">' +
    '<div style="background:#173447;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;">' +
    '<strong>บริษัท เอส เมททอล เทค จำกัด — แจ้งเตือนทะเบียนเครื่องมือวัด (RG-PD-001)</strong>' +
    '</div>' +
    '<div style="border:1px solid #d3e0e6;border-top:none;padding:18px;border-radius:0 0 8px 8px;background:#ffffff;">' +
    '<p style="margin-top:0;">รายการเครื่องมือวัดที่ใกล้ครบกำหนดวันหมดอายุ ประจำวันที่ <strong>' +
    escapeHtml_(formatIsoToDmy_(todayBangkok)) +
    '</strong> (จำนวน ' +
    dueItems.length +
    ' รายการ):</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
    '<thead><tr style="background:#edf3f5;text-align:left;">' +
    '<th style="padding:8px;border:1px solid #d3e0e6;">รหัส</th>' +
    '<th style="padding:8px;border:1px solid #d3e0e6;">เครื่องมือวัด</th>' +
    '<th style="padding:8px;border:1px solid #d3e0e6;">สถานที่ใช้งาน</th>' +
    '<th style="padding:8px;border:1px solid #d3e0e6;">วันหมดอายุ</th>' +
    '<th style="padding:8px;border:1px solid #d3e0e6;">คงเหลือ</th>' +
    '</tr></thead>' +
    '<tbody>' +
    htmlRows.join('') +
    '</tbody></table>' +
    '<p style="font-size:12px;color:#5d7788;margin-bottom:0;">หมายเหตุ: ระบบแจ้งเตือนล่วงหน้า 7 วัน (หรือส่งชดเชย 1 ครั้งหากเหลือ 1–6 วัน) และจะเริ่มรอบใหม่เมื่อ Admin แก้ไขวันหมดอายุ</p>' +
    '</div></div>';

  return {
    subject: subject,
    plainBody: plainLines.join('\n'),
    htmlBody: htmlBody
  };
}
