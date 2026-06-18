
function parseDDMMYYYY(str) {
  const parts = str.split(/[\/\-]/);

  if (parts.length !== 3) return null;

  let [day, month, year] = parts.map(Number);

  // convert 2-digit year
  if (year < 100) year += 2000;

  const date = new Date(year, month - 1, day);

  // strict validation
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.toISOString().split("T")[0];
}



function parseDate(input) {
  const parsed = parseDDMMYYYY(input);

  if (!parsed) return null;

  const date = new Date(parsed);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  date.setHours(0, 0, 0, 0);

  const currentYear = today.getFullYear();

  // allow only current year to next 5 years
  if (
    date.getFullYear() < currentYear ||
    date.getFullYear() > currentYear + 5
  ) {
    return null;
  }

  // prevent past dates
  if (date < today) {
    return null;
  }

  return parsed;
}

module.exports = {
  parseDate,
  parseDDMMYYYY,
};