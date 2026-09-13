// Public allotment-matrix mirror: the MUN platform POSTs every allotment /
// payment state change here and this script colors the sheet cell.
//
//   white  = available
//   amber  = allotted, payment pending
//   green  = paid / confirmed
//
// Install (one time):
//   1. Create the Google Sheet you want to share publicly.
//   2. Extensions → Apps Script → paste this file → set SECRET below.
//   3. Deploy → New deployment → type "Web app" →
//      Execute as: Me · Who has access: Anyone → Deploy.
//   4. Copy the web app URL into /admin/config → Payments tab → Sheet mirror URL.
//   5. Set the same SECRET value as SHEET_SYNC_SECRET in the AWS app environment.
//
// Each committee gets its own tab, rows are appended as portfolios first sync.
// Sync is fire-and-forget from the platform; a failed call just means the
// sheet lags until the next state change for that cell.

var SECRET = "PASTE_SHEET_SYNC_SECRET";

var COLORS = {
  available: "#ffffff",
  allotted: "#fff2cc", // amber — allotted, not paid
  paid: "#d9ead3",     // green — paid / confirmed
};

function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  if (d.secret !== SECRET) {
    return ContentService.createTextOutput("unauthorized");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(d.committee) || ss.insertSheet(d.committee);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["Portfolio", "Status"]);
    sh.getRange(1, 1, 1, 2).setFontWeight("bold");
  }

  var last = sh.getLastRow();
  var row = -1;
  if (last > 1) {
    var names = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      if (names[i][0] === d.portfolio) { row = i + 2; break; }
    }
  }
  if (row === -1) {
    sh.appendRow([d.portfolio, d.state]);
    row = sh.getLastRow();
  }

  var label = d.state === "paid" ? "Paid" : d.state === "allotted" ? "Allotted (payment pending)" : "Available";
  sh.getRange(row, 2).setValue(label);
  sh.getRange(row, 1, 1, 2).setBackground(COLORS[d.state] || "#ffffff");

  return ContentService.createTextOutput("ok");
}
