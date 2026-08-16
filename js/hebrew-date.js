// תאריך עברי לכל עמודי print-site (היסטוריה, לוג שליחה). משתמש בלוח העברי
// המובנה של Intl (u-ca-hebrew) - בלי טבלאות ידניות, מדויק ונתמך בכל
// דפדפן מודרני. מספרי היום/השנה מומרים לאותיות (כ"ז, תשפ"ו) בעצמנו.
(function () {
  var fmt = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });

  var ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  var TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  var HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

  function withGershayim(str) {
    if (str.length === 1) return str + '׳';
    return str.slice(0, -1) + '״' + str.slice(-1);
  }

  // 1..999 -> אותיות (עם ט"ו/ט"ז במקום י"ה/י"ו)
  function numToLetters(n) {
    var out = '';
    out += HUNDREDS[Math.floor(n / 100)];
    var rest = n % 100;
    if (rest === 15) out += 'טו';
    else if (rest === 16) out += 'טז';
    else out += TENS[Math.floor(rest / 10)] + ONES[rest % 10];
    return withGershayim(out);
  }

  // שנה: מסירים את האלפים (5786 -> תשפ"ו)
  function yearToLetters(y) {
    return numToLetters(y % 1000);
  }

  window.formatHebrewDate = function (date) {
    try {
      var d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return '';
      var parts = fmt.formatToParts(d);
      var day = 0, month = '', year = 0;
      parts.forEach(function (p) {
        if (p.type === 'day') day = parseInt(p.value, 10);
        else if (p.type === 'month') month = p.value;
        else if (p.type === 'year') year = parseInt(p.value, 10);
      });
      if (!day || !month || !year) return fmt.format(d);
      return numToLetters(day) + ' ב' + month + ' ' + yearToLetters(year);
    } catch (e) {
      return '';
    }
  };

  // "כ״ז באב תשפ״ו, 23:47" - תאריך עברי + שעה בלבד (ההיסטוריה משתמשת בזה)
  window.formatHebrewDateTime = function (date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var heb = window.formatHebrewDate(d) || d.toLocaleDateString('he-IL');
    return heb + ', ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  };

  // "כ״ז באב תשפ״ו · 16.8.2026 23:47" - הפורמט המשולב שמוצג בטבלאות
  window.formatHebrewAndGregorian = function (date, withTime) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var greg = d.toLocaleDateString('he-IL');
    if (withTime) greg += ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    var heb = window.formatHebrewDate(d);
    return heb ? heb + ' · ' + greg : greg;
  };
})();
