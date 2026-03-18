const MONTH_NAMES = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const NUMERIC_DATE_PATTERN = /\b\d{2}[\/-]\d{2}[\/-]\d{2,4}\b/;
const TEXTUAL_DATE_PATTERN = new RegExp(`\\b(?:${MONTH_NAMES})\\s+\\d{1,2},\\s+\\d{4}\\b`, "i");
const DATE_PATTERN = new RegExp(
  `(?:${NUMERIC_DATE_PATTERN.source})|(?:${TEXTUAL_DATE_PATTERN.source})`,
  "i"
);
const AMOUNT_PATTERN =
  /(?:₹|Rs\.?\s*)\s*-?\d[\d,]*(?:\.\d{2})?|-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|-?\d+\.\d{2}/g;
const TIME_PATTERN = /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;
const CREDIT_KEYWORDS = [
  "credit",
  "cr",
  "salary",
  "refund",
  "interest",
  "deposit",
  "cash dep",
  "received",
  "received from",
  "credited to",
  "reversal"
];
const DEBIT_KEYWORDS = [
  "debit",
  "dr",
  "withdrawal",
  "cash wdl",
  "atm",
  "purchase",
  "payment",
  "upi",
  "paid to",
  "pos",
  "bill",
  "transfer to",
  "neft",
  "imps",
  "charge"
];

function detectAndParse(text) {
  return parseAdvanced(text);
}

function parseAdvanced(text) {
  const entries = collectEntries(text);
  const rows = [];
  let previousBalance = null;

  entries.forEach(entry => {
    const parsed = parseEntry(entry, previousBalance);

    if (!parsed) {
      return;
    }

    rows.push({
      date: parsed.date,
      description: parsed.description,
      debit: parsed.debit,
      credit: parsed.credit
    });

    if (parsed.balance !== null) {
      previousBalance = parsed.balance;
    }
  });

  return rows;
}

function collectEntries(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const entries = [];
  let current = "";

  lines.forEach(line => {
    if (DATE_PATTERN.test(line)) {
      if (current) {
        entries.push(current.trim());
      }

      current = line;
      return;
    }

    if (current) {
      current += " " + line;
    }
  });

  if (current) {
    entries.push(current.trim());
  }

  if (entries.length) {
    return entries;
  }

  return text
    .split(/(?=\b\d{2}[\/-]\d{2}[\/-]\d{2,4}\b)/)
    .map(block => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseEntry(entry, previousBalance) {
  const dateMatch = entry.match(DATE_PATTERN);

  if (!dateMatch) {
    return null;
  }

  const date = dateMatch[0];
  const body = entry.replace(date, "").trim();
  const amountStrings = body.match(AMOUNT_PATTERN) || [];
  const amounts = amountStrings.map(parseAmount);

  if (!amounts.length) {
    return null;
  }

  const hint = inferDirectionFromKeywords(body);
  const analysis = analyzeAmounts(amounts, previousBalance, hint);
  const description = cleanDescription(body, amountStrings);

  return {
    date,
    description: description || body.slice(0, 120),
    debit: analysis.direction === "debit" ? analysis.amount : "",
    credit: analysis.direction === "credit" ? analysis.amount : "",
    balance: analysis.balance
  };
}

function analyzeAmounts(amounts, previousBalance, hint) {
  if (!amounts.length) {
    return {
      amount: "",
      direction: hint || "debit",
      balance: previousBalance
    };
  }

  const diffPair = findDiffPair(amounts);

  if (diffPair) {
    const direction = hint || inferDirectionFromBalances(diffPair.currentBalance, diffPair.previousBalance);

    return {
      amount: diffPair.amount,
      direction: direction || "debit",
      balance: diffPair.currentBalance
    };
  }

  if (hint && amounts.length === 1) {
    return {
      amount: amounts[0],
      direction: hint,
      balance: previousBalance
    };
  }

  if (amounts.length >= 2) {
    const currentBalance = amounts[amounts.length - 1];
    const candidates = amounts.slice(0, -1);

    if (previousBalance !== null) {
      const balanceDirection = inferDirectionFromBalances(currentBalance, previousBalance);
      const balanceDelta = roundToCents(Math.abs(currentBalance - previousBalance));
      const matchedAmount = findClosestAmount(candidates, balanceDelta);

      if (matchedAmount !== null) {
        return {
          amount: matchedAmount,
          direction: balanceDirection || hint || "debit",
          balance: currentBalance
        };
      }
    }

    return {
      amount: candidates[candidates.length - 1],
      direction: hint || "debit",
      balance: currentBalance
    };
  }

  return {
    amount: amounts[0],
    direction: hint || "debit",
    balance: previousBalance
  };
}

function findDiffPair(amounts) {
  let bestMatch = null;

  for (let i = 0; i < amounts.length; i++) {
    for (let j = i + 1; j < amounts.length; j++) {
      for (let k = 0; k < amounts.length; k++) {
        if (k === i || k === j) {
          continue;
        }

        const difference = roundToCents(Math.abs(amounts[i] - amounts[j]));

        if (difference === roundToCents(amounts[k])) {
          const match = {
            amount: amounts[k],
            currentBalance: amounts[i],
            previousBalance: amounts[j]
          };

          if (!bestMatch || match.amount < bestMatch.amount) {
            bestMatch = match;
          }
        }
      }
    }
  }

  return bestMatch;
}

function findClosestAmount(candidates, target) {
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  candidates.forEach(candidate => {
    const delta = Math.abs(candidate - target);

    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  });

  return bestDelta <= 0.01 ? best : null;
}

function inferDirectionFromBalances(currentBalance, previousBalance) {
  if (currentBalance > previousBalance) {
    return "credit";
  }

  if (currentBalance < previousBalance) {
    return "debit";
  }

  return "";
}

function inferDirectionFromKeywords(body) {
  const normalized = " " + body.toLowerCase() + " ";

  if (containsKeyword(normalized, CREDIT_KEYWORDS)) {
    return "credit";
  }

  if (containsKeyword(normalized, DEBIT_KEYWORDS)) {
    return "debit";
  }

  return "";
}

function containsKeyword(body, keywords) {
  return keywords.some(keyword => body.includes(" " + keyword + " "));
}

function cleanDescription(body, amountStrings) {
  let description = body;

  amountStrings.forEach(amount => {
    description = description.replace(amount, " ");
  });

  return description
    .replace(TIME_PATTERN, " ")
    .replace(/\b(?:debit|credit)\b/gi, " ")
    .replace(/\b(?:cr|dr)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function parseAmount(value) {
  return parseFloat(value.replace(/₹/g, "").replace(/Rs\.?\s*/gi, "").replace(/,/g, "").trim());
}

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}
