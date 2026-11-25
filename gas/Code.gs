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
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f7f8" style="width:100%;background-color:#f4f7f8;margin:0;padding:0;">' +
        '<tr>' +
          '<td align="center" style="padding:14px 12px 0 12px;">' +
            '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;">' +
              '<tr>' +
                '<td bgcolor="#fef5e7" style="background-color:#fef5e7;border:1px solid #f0cf99;padding:10px 14px;font-family:Tahoma,\'Segoe UI\',Arial,sans-serif;font-size:13px;line-height:20px;color:#8c5306;mso-line-height-rule:exactly;">' +
                  '<strong>อีเมลทดสอบระบบ (Test Sample)</strong> &mdash; จำลองวันตรวจที่ ' +
                  escapeHtml_(formatIsoToDmy_(simulatedBangkokDate)) +
                  ' (ไม่กระทบสถานะแจ้งเตือนจริงในฐานข้อมูล)' +
                '</td>' +
              '</tr>' +
            '</table>' +
            '<!--[if mso]></td></tr></table><![endif]-->' +
          '</td>' +
        '</tr>' +
      '</table>' +
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

  var fontMain = "Tahoma,'Segoe UI',Arial,sans-serif";
  var fontMono = "Consolas,'Courier New',monospace";

  var htmlCards = [];
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

    var sizeText = item.size ? '  |  ขนาด ' + item.size : '';
    htmlCards.push(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:12px;">' +
        '<tr>' +
          '<td width="4" bgcolor="#ea580c" style="width:4px;background-color:#ea580c;font-size:0;line-height:0;">&nbsp;</td>' +
          '<td bgcolor="#f8faff" style="background-color:#f8faff;border-top:1px solid #d5dcf0;border-right:1px solid #d5dcf0;border-bottom:1px solid #d5dcf0;padding:14px 16px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">' +
              '<tr>' +
                '<td align="left" valign="middle" style="padding-bottom:10px;">' +
                  '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' +
                    '<tr>' +
                      '<td bgcolor="#ffedd5" style="background-color:#ffedd5;border:1px solid #fdba74;padding:4px 10px;font-family:' +
                        fontMono +
                        ';font-size:13px;font-weight:bold;line-height:18px;color:#9a3412;white-space:nowrap;mso-line-height-rule:exactly;">' +
                        escapeHtml_(item.instrument_code) +
                      '</td>' +
                    '</tr>' +
                  '</table>' +
                '</td>' +
                '<td align="right" valign="middle" style="padding-bottom:10px;">' +
                  '<table role="presentation" cellpadding="0" cellspacing="0" align="right" style="border-collapse:collapse;">' +
                    '<tr>' +
                      '<td bgcolor="#fef9c3" style="background-color:#fef9c3;border:1px solid #fde047;padding:4px 10px;font-family:' +
                        fontMain +
                        ';font-size:12px;font-weight:bold;line-height:18px;color:#854d0e;white-space:nowrap;mso-line-height-rule:exactly;">' +
                        'เหลือ ' +
                        item.days_remaining +
                        ' วัน' +
                        escapeHtml_(note) +
                      '</td>' +
                    '</tr>' +
                  '</table>' +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td colspan="2" style="padding-bottom:12px;font-family:' +
                  fontMain +
                  ';font-size:16px;font-weight:bold;line-height:24px;color:#172554;mso-line-height-rule:exactly;">' +
                  escapeHtml_(item.name) +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td colspan="2" style="border-top:1px solid #e0e7ff;padding-top:10px;">' +
                  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">' +
                    '<tr>' +
                      '<td width="56%" align="left" valign="top" style="padding-right:10px;">' +
                        '<div style="font-family:' +
                          fontMain +
                          ';font-size:12px;line-height:18px;color:#55658e;margin:0 0 3px 0;mso-line-height-rule:exactly;">สถานที่ใช้งาน / หน่วยงาน</div>' +
                        '<div style="font-family:' +
                          fontMain +
                          ';font-size:14px;font-weight:bold;line-height:21px;color:#172554;margin:0;mso-line-height-rule:exactly;">' +
                          escapeHtml_(item.location || 'ไม่ระบุ') +
                          '<span style="font-weight:normal;color:#3b4b75;font-size:13px;">' +
                          escapeHtml_(sizeText) +
                          '</span>' +
                        '</div>' +
                      '</td>' +
                      '<td width="44%" align="right" valign="top">' +
                        '<div style="font-family:' +
                          fontMain +
                          ';font-size:12px;line-height:18px;color:#55658e;margin:0 0 3px 0;white-space:nowrap;mso-line-height-rule:exactly;">วันหมดอายุ (EXPIRED)</div>' +
                        '<div style="font-family:' +
                          fontMono +
                          ';font-size:15px;font-weight:bold;line-height:21px;color:#c2410c;margin:0;white-space:nowrap;mso-line-height-rule:exactly;">' +
                          escapeHtml_(formatIsoToDmy_(item.expiry_date)) +
                        '</div>' +
                      '</td>' +
                    '</tr>' +
                  '</table>' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +
      '</table>'
    );
  }

  plainLines.push('');
  plainLines.push('เปิดระบบจัดการทะเบียน: https://smetaltech027-afk.github.io/measuring-instrument-system/?view=admin');
  plainLines.push('อีเมลนี้ส่งอัตโนมัติจากระบบทะเบียนเครื่องมือวัด (ส่ง 1 ครั้งต่อรอบวันหมดอายุ)');

  var htmlBody =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f7fc" style="width:100%;background-color:#f6f7fc;margin:0;padding:0;">' +
      '<tr>' +
        '<td align="center" style="padding:16px 12px 24px 12px;">' +
          '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border:1px solid #d5dcf0;">' +
            '<tr>' +
              '<td bgcolor="#1e3a8a" style="background-color:#1e3a8a;padding:18px 20px;">' +
                '<div style="font-family:' +
                  fontMain +
                  ';font-size:12px;line-height:18px;color:#fed7aa;margin:0 0 4px 0;mso-line-height-rule:exactly;">บริษัท เอส เมททอล เทค จำกัด &bull; เอกสาร RG-PD-001</div>' +
                '<div style="font-family:' +
                  fontMain +
                  ';font-size:18px;font-weight:bold;line-height:26px;color:#ffffff;margin:0;mso-line-height-rule:exactly;">แจ้งเตือนเครื่องมือวัดใกล้ครบกำหนด</div>' +
              '</td>' +
            '</tr>' +
            '<tr>' +
              '<td bgcolor="#ffffff" style="background-color:#ffffff;padding:20px;">' +
                '<p style="font-family:' +
                  fontMain +
                  ';font-size:14px;line-height:22px;color:#172554;margin:0 0 16px 0;mso-line-height-rule:exactly;">' +
                  'รายการเครื่องมือวัดที่ใกล้ครบกำหนดวันหมดอายุ ประจำวันที่ ' +
                  '<strong style="white-space:nowrap;">' +
                  escapeHtml_(formatIsoToDmy_(todayBangkok)) +
                  '</strong> (ทั้งหมด <strong>' +
                  dueItems.length +
                  '</strong> รายการ)' +
                '</p>' +
                htmlCards.join('') +
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:18px;">' +
                  '<tr>' +
                    '<td align="center">' +
                      '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;">' +
                        '<tr>' +
                          '<td bgcolor="#ea580c" style="background-color:#ea580c;padding:11px 24px;text-align:center;">' +
                            '<a href="https://smetaltech027-afk.github.io/measuring-instrument-system/?view=admin" ' +
                              'style="font-family:' +
                              fontMain +
                              ';font-size:14px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;display:inline-block;">' +
                              'เปิดดูทะเบียนในระบบ Admin' +
                            '</a>' +
                          '</td>' +
                        '</tr>' +
                      '</table>' +
                    '</td>' +
                  '</tr>' +
                '</table>' +
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:20px;">' +
                  '<tr>' +
                    '<td style="border-top:1px solid #e0e7ff;padding-top:14px;font-family:' +
                      fontMain +
                      ';font-size:12px;line-height:20px;color:#55658e;mso-line-height-rule:exactly;">' +
                      'หมายเหตุ: ระบบแจ้งเตือนล่วงหน้า 7 วัน (หรือส่งชดเชย 1 ครั้งหากเหลือ 1&ndash;6 วัน) และจะเริ่มรอบใหม่เมื่อ Admin อัปเดตวันหมดอายุในระบบ' +
                    '</td>' +
                  '</tr>' +
                '</table>' +
              '</td>' +
            '</tr>' +
          '</table>' +
          '<!--[if mso]></td></tr></table><![endif]-->' +
        '</td>' +
      '</tr>' +
    '</table>';

  return {
    subject: subject,
    plainBody: plainLines.join('\n'),
    htmlBody: htmlBody
  };
}
