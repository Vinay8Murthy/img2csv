const STORAGE_KEY = "expenseTrackerTransactions";
const OPTIONS_STORAGE_KEY = "expenseTrackerOptions";
const MANUAL_IMPORT_STORAGE_KEY = "expenseTrackerManualImportText";
const DATE_INPUT_PATTERN = /^\d{2}[\/-]\d{2}[\/-]\d{2,4}$|^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/i;
const ENTRY_DATE_PATTERN = /\b(?:\d{2}[\/-]\d{2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})\b/i;
const TIME_PATTERN = /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;
const CURRENCY_PATTERN =
  /(?:₹|Rs\.?\s*)\s*-?\d[\d,]*(?:\.\d{2})?|-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|-?\d+\.\d{2}/g;
const FIELD_CONFIG = [
  { key: "date", type: "text" },
  { key: "description", type: "text" },
  { key: "debit", type: "number" },
  { key: "credit", type: "number" },
  { key: "category", type: "select", optionType: "category" },
  { key: "subCategory", type: "select", optionType: "subCategory" },
  { key: "group", type: "select", optionType: "group" }
];
const OPTION_CONFIG = {
  category: {
    inputId: "categoryInput",
    listId: "categoryList",
    errorId: "categoryError",
    emptyMessage: "No categories created yet.",
    panelName: "categories"
  },
  subCategory: {
    inputId: "subCategoryInput",
    listId: "subCategoryList",
    errorId: "subCategoryError",
    emptyMessage: "No sub categories created yet.",
    panelName: "subCategories"
  },
  group: {
    inputId: "groupInput",
    listId: "groupList",
    errorId: "groupError",
    emptyMessage: "No groups created yet.",
    panelName: "groups"
  }
};
const NEW_OPTION_VALUE = "__new__";

let transactions = loadTransactions();
let options = loadOptions();
let manualDrafts = [];
let selectedIds = new Set();
let currentFilter = "";
let currentSort = "importedAt-desc";

document.getElementById("addRowBtn").onclick = addRow;
document.getElementById("deleteSelectedBtn").onclick = deleteSelectedRows;
document.getElementById("csvBtn").onclick = downloadCsv;
document.getElementById("excelBtn").onclick = downloadExcel;
document.getElementById("pdfBtn").onclick = downloadPdf;
document.getElementById("clearBtn").onclick = clearAll;
document.getElementById("filterInput").addEventListener("input", event => {
  currentFilter = event.target.value.trim().toLowerCase();
  render();
});
document.getElementById("sortSelect").addEventListener("change", event => {
  currentSort = event.target.value;
  render();
});
document.getElementById("selectAllRows").addEventListener("change", event => {
  toggleSelectAllVisible(event.target.checked);
});
document.getElementById("generateDraftsBtn").onclick = generateManualDrafts;
document.getElementById("addDraftsBtn").onclick = addManualDraftsToTracker;
document.getElementById("clearManualImportBtn").onclick = clearManualImport;

bindTabs();
bindOptionManagers();
loadManualImportState();
setActiveTab(getInitialTab());
render();

function loadTransactions() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw).map(createTransactionRecord);
  } catch (error) {
    console.error("Failed to load transactions", error);
    return [];
  }
}

function loadOptions() {
  const fallback = {
    category: [],
    subCategory: [],
    group: []
  };
  const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);

    return {
      category: sanitizeOptions(parsed.category),
      subCategory: sanitizeOptions(parsed.subCategory),
      group: sanitizeOptions(parsed.group)
    };
  } catch (error) {
    console.error("Failed to load options", error);
    return fallback;
  }
}

function createTransactionRecord(transaction = {}) {
  return {
    id: transaction.id || createRecordId(),
    date: transaction.date || "",
    description: transaction.description || "",
    debit: transaction.debit || "",
    credit: transaction.credit || "",
    category: transaction.category || "",
    subCategory: transaction.subCategory || "",
    group: transaction.group || "",
    sourceFile: transaction.sourceFile || "",
    importedAt: transaction.importedAt || new Date().toISOString()
  };
}

function createRecordId() {
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function render() {
  const tbody = document.querySelector("#table tbody");
  const trackerStatus = document.getElementById("trackerStatus");
  const validationSummary = document.getElementById("validationSummary");
  const selectAll = document.getElementById("selectAllRows");
  const filterInput = document.getElementById("filterInput");
  const sortSelect = document.getElementById("sortSelect");
  const visibleTransactions = getVisibleTransactions();
  const issues = collectValidationIssues();

  tbody.innerHTML = "";
  filterInput.value = currentFilter;
  sortSelect.value = currentSort;

  if (!transactions.length) {
    trackerStatus.textContent = "No records loaded yet. Scan a statement or add a row manually.";
  } else {
    trackerStatus.textContent =
      `${visibleTransactions.length} visible of ${transactions.length} total record(s). ` +
      "Previously scanned records stay here until you clear them.";
  }

  validationSummary.textContent = issues.length
    ? `${issues.length} validation issue(s) found. Complete the highlighted fields before exporting.`
    : "All records look valid for export.";
  validationSummary.className = issues.length ? "validation-summary invalid" : "validation-summary valid";

  visibleTransactions.forEach(transaction => {
    const row = document.createElement("tr");
    const rowIssues = validateTransaction(transaction);
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(transaction.id);
    checkbox.setAttribute("aria-label", "Select row");
    checkbox.addEventListener("change", event => {
      toggleSelected(transaction.id, event.target.checked);
    });
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);

    FIELD_CONFIG.forEach(field => {
      const cell = document.createElement("td");
      let control;

      if (field.type === "select") {
        control = createSelect(field.optionType, transaction[field.key], value => {
          if (value === NEW_OPTION_VALUE) {
            createOptionFromPrompt(field.optionType, transaction.id, field.key, transaction[field.key]);
            return;
          }

          update(transaction.id, field.key, value);
        });
      } else {
        control = document.createElement("input");
        control.value = transaction[field.key];
        control.type = "text";
        control.setAttribute("aria-label", field.key);

        if (field.key === "date") {
          control.placeholder = "DD/MM/YY";
        }

        if (field.key === "debit" || field.key === "credit") {
          control.placeholder = "0.00";
        }

        control.addEventListener("input", event => {
          update(transaction.id, field.key, event.target.value);
        });
      }

      if (rowIssues[field.key]) {
        control.classList.add("field-error");
        control.title = rowIssues[field.key];
      }

      cell.appendChild(control);
      row.appendChild(cell);
    });

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");

    removeButton.textContent = "Delete";
    removeButton.className = "danger";
    removeButton.onclick = () => removeRow(transaction.id);
    actionCell.appendChild(removeButton);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });

  selectAll.checked =
    visibleTransactions.length > 0 && visibleTransactions.every(transaction => selectedIds.has(transaction.id));

  renderManualDrafts();
  renderOptionManagers();
}

function bindTabs() {
  document.querySelectorAll(".tab-button").forEach(button => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });
}

function getInitialTab() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("tab");

  if (requested) {
    return requested;
  }

  const manualText = localStorage.getItem(MANUAL_IMPORT_STORAGE_KEY);
  return manualText ? "manualImport" : "records";
}

function setActiveTab(tabName) {
  document.querySelectorAll(".tab-button").forEach(button => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

function update(id, key, value) {
  transactions = transactions.map(transaction =>
    transaction.id === id ? { ...transaction, [key]: value } : transaction
  );
  saveTransactions();
  render();
}

function removeRow(id) {
  transactions = transactions.filter(transaction => transaction.id !== id);
  selectedIds.delete(id);
  saveTransactions();
  render();
}

function addRow() {
  transactions.push(createTransactionRecord());
  saveTransactions();
  render();
}

function clearAll() {
  transactions = [];
  selectedIds.clear();
  saveTransactions();
  render();
}

function deleteSelectedRows() {
  if (!selectedIds.size) {
    window.alert("Select at least one row to delete.");
    return;
  }

  transactions = transactions.filter(transaction => !selectedIds.has(transaction.id));
  selectedIds.clear();
  saveTransactions();
  render();
}

function toggleSelected(id, checked) {
  if (checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
}

function toggleSelectAllVisible(checked) {
  getVisibleTransactions().forEach(transaction => {
    if (checked) {
      selectedIds.add(transaction.id);
    } else {
      selectedIds.delete(transaction.id);
    }
  });
  render();
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function saveOptions() {
  localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options));
}

function getVisibleTransactions() {
  const filtered = transactions.filter(transaction => matchesFilter(transaction, currentFilter));
  return filtered.sort(compareTransactions(currentSort));
}

function matchesFilter(transaction, filter) {
  if (!filter) {
    return true;
  }

  const haystack = [
    transaction.date,
    transaction.description,
    transaction.debit,
    transaction.credit,
    transaction.category,
    transaction.subCategory,
    transaction.group,
    transaction.sourceFile
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(filter);
}

function compareTransactions(sortValue) {
  const [field, direction] = sortValue.split("-");
  const multiplier = direction === "asc" ? 1 : -1;

  return (left, right) => {
    let leftValue;
    let rightValue;

    if (field === "amount") {
      leftValue = parseAmountValue(left.debit || left.credit);
      rightValue = parseAmountValue(right.debit || right.credit);
    } else if (field === "date") {
      leftValue = parseDateValue(left.date);
      rightValue = parseDateValue(right.date);
    } else if (field === "importedAt") {
      leftValue = Date.parse(left.importedAt || 0);
      rightValue = Date.parse(right.importedAt || 0);
    } else {
      leftValue = String(left[field] || "").toLowerCase();
      rightValue = String(right[field] || "").toLowerCase();
    }

    if (leftValue < rightValue) {
      return -1 * multiplier;
    }

    if (leftValue > rightValue) {
      return 1 * multiplier;
    }

    return 0;
  };
}

function parseDateValue(value) {
  const text = String(value || "").trim();

  if (!text) {
    return 0;
  }

  if (/^\d{2}[\/-]\d{2}[\/-]\d{2,4}$/.test(text)) {
    const [day, month, yearText] = text.split(/[\/-]/);
    const year = yearText.length === 2 ? `20${yearText}` : yearText;
    return Date.parse(`${year}-${month}-${day}`) || 0;
  }

  return Date.parse(text) || 0;
}

function parseAmountValue(value) {
  return parseFloat(String(value || "").replace(/,/g, "").trim()) || 0;
}

function downloadCsv() {
  if (!ensureValidForExport()) {
    return;
  }

  const csv = Papa.unparse(transactions.map(stripInternalFields));
  downloadFile(csv, "transactions.csv", "text/csv");
}

function downloadExcel() {
  if (!ensureValidForExport()) {
    return;
  }

  const ws = XLSX.utils.json_to_sheet(transactions.map(stripInternalFields));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  XLSX.writeFile(wb, "transactions.xlsx");
}

function downloadPdf() {
  if (!ensureValidForExport()) {
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const rows = transactions.map(transaction => [
    transaction.date,
    transaction.description,
    transaction.debit,
    transaction.credit,
    transaction.category,
    transaction.subCategory,
    transaction.group
  ]);

  doc.setFontSize(16);
  doc.text("Expense Tracker Export", 14, 16);
  doc.autoTable({
    startY: 24,
    head: [["Date", "Description", "Debit", "Credit", "Category", "Sub Category", "Group"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [31, 107, 82] },
    columnStyles: { 1: { cellWidth: 70 } }
  });
  doc.save("transactions.pdf");
}

function stripInternalFields(transaction) {
  return {
    date: transaction.date,
    description: transaction.description,
    debit: transaction.debit,
    credit: transaction.credit,
    category: transaction.category,
    subCategory: transaction.subCategory,
    group: transaction.group,
    sourceFile: transaction.sourceFile,
    importedAt: transaction.importedAt
  };
}

function downloadFile(content, name, type) {
  const blob = new Blob([content], { type });
  const anchor = document.createElement("a");

  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();

  URL.revokeObjectURL(anchor.href);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bindOptionManagers() {
  document.querySelectorAll("[data-add-option]").forEach(button => {
    button.addEventListener("click", () => {
      addOption(button.dataset.addOption);
    });
  });
}

function renderOptionManagers() {
  Object.keys(OPTION_CONFIG).forEach(type => {
    const { listId, emptyMessage, errorId } = OPTION_CONFIG[type];
    const container = document.getElementById(listId);
    const error = document.getElementById(errorId);

    error.textContent = "";

    if (!options[type].length) {
      container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
      return;
    }

    container.innerHTML = options[type]
      .map(
        option => `
          <div class="option-row">
            <input
              type="text"
              value="${escapeHtml(option)}"
              data-option-type="${type}"
              data-option-value="${escapeHtml(option)}"
            >
            <button class="secondary" data-save-option="${type}" data-previous-value="${escapeHtml(option)}">Save</button>
            <button class="danger" data-delete-option="${type}" data-option-value="${escapeHtml(option)}">Delete</button>
          </div>
        `
      )
      .join("");
  });

  bindOptionRowActions();
}

function bindOptionRowActions() {
  document.querySelectorAll("[data-save-option]").forEach(button => {
    button.onclick = () => {
      const type = button.dataset.saveOption;
      const previousValue = button.dataset.previousValue;
      const input = button.parentElement.querySelector("input");
      renameOption(type, previousValue, input.value);
    };
  });

  document.querySelectorAll("[data-delete-option]").forEach(button => {
    button.onclick = () => {
      deleteOption(button.dataset.deleteOption, button.dataset.optionValue);
    };
  });
}

function createSelect(type, selectedValue, onChange) {
  const select = document.createElement("select");
  const placeholder = document.createElement("option");

  placeholder.value = "";
  placeholder.textContent = `Select ${type}`;
  select.appendChild(placeholder);

  options[type].forEach(option => {
    const optionElement = document.createElement("option");

    optionElement.value = option;
    optionElement.textContent = option;
    select.appendChild(optionElement);
  });

  const newOptionElement = document.createElement("option");
  newOptionElement.value = NEW_OPTION_VALUE;
  newOptionElement.textContent = "Add new...";
  select.appendChild(newOptionElement);

  select.value = options[type].includes(selectedValue) ? selectedValue : "";
  select.addEventListener("change", event => onChange(event.target.value));
  select.setAttribute("aria-label", type);

  return select;
}

function createOptionFromPrompt(type, recordId, fieldKey, currentValue) {
  const label = readableType(type);
  const value = window.prompt(`Create a new ${label.toLowerCase()}:`, currentValue || "");

  if (value === null) {
    render();
    return;
  }

  const result = addOption(type, value, false);

  if (!result.ok) {
    showOptionError(type, result.message);
    render();
    return;
  }

  update(recordId, fieldKey, result.value);
  setActiveTab("records");
}

function addOption(type, explicitValue, switchTab = true) {
  const config = OPTION_CONFIG[type];
  const input = document.getElementById(config.inputId);
  const rawValue = explicitValue !== undefined ? explicitValue : input.value;
  const value = sanitizeOption(rawValue);

  if (!value) {
    showOptionError(type, `Enter a ${readableType(type).toLowerCase()} name before saving.`);
    return { ok: false, message: "Missing option value." };
  }

  if (options[type].some(option => option.toLowerCase() === value.toLowerCase())) {
    showOptionError(type, `${readableType(type)} already exists.`);
    return { ok: false, message: "Duplicate option value." };
  }

  options[type].push(value);
  options[type].sort((a, b) => a.localeCompare(b));
  saveOptions();
  render();

  if (explicitValue === undefined) {
    input.value = "";
  }

  if (switchTab) {
    setActiveTab(OPTION_CONFIG[type].panelName);
  }

  return { ok: true, value };
}

function renameOption(type, previousValue, nextValue) {
  const cleaned = sanitizeOption(nextValue);

  if (!cleaned) {
    showOptionError(type, `${readableType(type)} cannot be empty.`);
    render();
    return;
  }

  if (
    cleaned.toLowerCase() !== previousValue.toLowerCase() &&
    options[type].some(option => option.toLowerCase() === cleaned.toLowerCase())
  ) {
    showOptionError(type, `${readableType(type)} already exists.`);
    render();
    return;
  }

  options[type] = options[type].map(option => (option === previousValue ? cleaned : option));
  transactions = transactions.map(transaction => {
    if (transaction[type] === previousValue) {
      return { ...transaction, [type]: cleaned };
    }

    return transaction;
  });

  saveOptions();
  saveTransactions();
  render();
}

function deleteOption(type, value) {
  options[type] = options[type].filter(option => option !== value);
  transactions = transactions.map(transaction => {
    if (transaction[type] === value) {
      return { ...transaction, [type]: "" };
    }

    return transaction;
  });

  saveOptions();
  saveTransactions();
  render();
}

function sanitizeOptions(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map(sanitizeOption).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sanitizeOption(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function showOptionError(type, message) {
  document.getElementById(OPTION_CONFIG[type].errorId).textContent = message;
}

function collectValidationIssues() {
  return transactions.flatMap((transaction, index) => {
    const issues = validateTransaction(transaction);
    return Object.values(issues).map(message => `Row ${index + 1}: ${message}`);
  });
}

function validateTransaction(transaction) {
  const issues = {};
  const hasDebit = Boolean(String(transaction.debit).trim());
  const hasCredit = Boolean(String(transaction.credit).trim());

  if (!DATE_INPUT_PATTERN.test(String(transaction.date).trim())) {
    issues.date = "Use a valid date like DD/MM/YY or Mar 15, 2026.";
  }

  if (!String(transaction.description).trim()) {
    issues.description = "Description is required.";
  }

  if (hasDebit && !isValidAmount(transaction.debit)) {
    issues.debit = "Debit must be a valid amount.";
  }

  if (hasCredit && !isValidAmount(transaction.credit)) {
    issues.credit = "Credit must be a valid amount.";
  }

  if (!hasDebit && !hasCredit) {
    issues.debit = "Enter either a debit or a credit amount.";
    issues.credit = "Enter either a debit or a credit amount.";
  }

  if (hasDebit && hasCredit) {
    issues.debit = "Use only one of debit or credit per row.";
    issues.credit = "Use only one of debit or credit per row.";
  }

  if (transaction.category && !options.category.includes(transaction.category)) {
    issues.category = "Choose a valid category.";
  }

  if (transaction.subCategory && !options.subCategory.includes(transaction.subCategory)) {
    issues.subCategory = "Choose a valid sub category.";
  }

  if (transaction.group && !options.group.includes(transaction.group)) {
    issues.group = "Choose a valid group.";
  }

  return issues;
}

function ensureValidForExport() {
  const issues = collectValidationIssues();

  if (!transactions.length) {
    window.alert("There are no records to export yet.");
    return false;
  }

  if (issues.length) {
    setActiveTab("records");
    window.alert("Please fix the highlighted validation issues before exporting.");
    render();
    return false;
  }

  return true;
}

function isValidAmount(value) {
  return /^\d+(?:\.\d{1,2})?$/.test(String(value).replace(/,/g, "").trim());
}

function readableType(type) {
  if (type === "subCategory") {
    return "Sub Category";
  }

  return type.charAt(0).toUpperCase() + type.slice(1);
}

function loadManualImportState() {
  const text = localStorage.getItem(MANUAL_IMPORT_STORAGE_KEY) || "";
  document.getElementById("manualImportText").value = text;

  if (text.trim()) {
    manualDrafts = createManualDrafts(text);
  }
}

function generateManualDrafts() {
  const text = document.getElementById("manualImportText").value;
  localStorage.setItem(MANUAL_IMPORT_STORAGE_KEY, text);
  manualDrafts = createManualDrafts(text);
  setActiveTab("manualImport");
  render();
}

function clearManualImport() {
  document.getElementById("manualImportText").value = "";
  localStorage.removeItem(MANUAL_IMPORT_STORAGE_KEY);
  manualDrafts = [];
  render();
}

function createManualDrafts(text) {
  const normalized = String(text || "").replace(/\r/g, "").trim();

  if (!normalized) {
    return [];
  }

  const parsedRows =
    typeof detectAndParse === "function" ? detectAndParse(normalized).map(createTransactionRecord) : [];

  if (parsedRows.length) {
    return parsedRows;
  }

  return splitManualEntries(normalized).map(buildDraftFromBlock);
}

function splitManualEntries(text) {
  const lines = text
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const entries = [];
  let current = "";

  lines.forEach(line => {
    if (ENTRY_DATE_PATTERN.test(line)) {
      if (current) {
        entries.push(current.trim());
      }
      current = line;
      return;
    }

    if (current) {
      current += " " + line;
    } else {
      current = line;
    }
  });

  if (current) {
    entries.push(current.trim());
  }

  return entries;
}

function buildDraftFromBlock(block) {
  const dateMatch = block.match(ENTRY_DATE_PATTERN);
  const date = dateMatch ? dateMatch[0] : "";
  const amounts = (block.match(CURRENCY_PATTERN) || []).map(value =>
    parseFloat(value.replace(/₹/g, "").replace(/Rs\.?\s*/gi, "").replace(/,/g, "").trim())
  );
  const lower = block.toLowerCase();
  const direction = lower.includes("credit") || lower.includes("received") ? "credit" : "debit";
  const amount = amounts.length ? amounts[amounts.length - 1] : "";
  const description = block
    .replace(date, " ")
    .replace(CURRENCY_PATTERN, " ")
    .replace(TIME_PATTERN, " ")
    .replace(/\b(?:debit|credit)\b/gi, " ")
    .replace(/\b(?:transaction id|utr no\.?|paid by|credited to)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return createTransactionRecord({
    date,
    description,
    debit: direction === "debit" ? amount : "",
    credit: direction === "credit" ? amount : ""
  });
}

function renderManualDrafts() {
  const tbody = document.querySelector("#manualDraftTable tbody");
  const status = document.getElementById("manualImportStatus");

  tbody.innerHTML = "";

  if (!manualDrafts.length) {
    status.textContent =
      document.getElementById("manualImportText").value.trim()
        ? "No draft rows generated yet. Try Generate Draft Rows and then edit the results."
        : "No OCR text loaded yet.";
    return;
  }

  status.textContent = `${manualDrafts.length} draft row(s) ready for review before import.`;

  manualDrafts.forEach((draft, index) => {
    const row = document.createElement("tr");

    FIELD_CONFIG.forEach(field => {
      const cell = document.createElement("td");
      let control;

      if (field.type === "select") {
        control = createSelect(field.optionType, draft[field.key], value => {
          if (value === NEW_OPTION_VALUE) {
            createManualDraftOption(field.optionType, index, field.key);
            return;
          }

          updateManualDraft(index, field.key, value);
        });
      } else {
        control = document.createElement("input");
        control.type = "text";
        control.value = draft[field.key];
        control.addEventListener("input", event => {
          updateManualDraft(index, field.key, event.target.value);
        });
      }

      cell.appendChild(control);
      row.appendChild(cell);
    });

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.textContent = "Delete";
    removeButton.className = "danger";
    removeButton.onclick = () => {
      manualDrafts.splice(index, 1);
      render();
    };
    actionCell.appendChild(removeButton);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });
}

function updateManualDraft(index, key, value) {
  manualDrafts[index][key] = value;
}

function createManualDraftOption(type, draftIndex, fieldKey) {
  const label = readableType(type);
  const value = window.prompt(`Create a new ${label.toLowerCase()}:`, "");

  if (value === null) {
    render();
    return;
  }

  const result = addOption(type, value, false);

  if (!result.ok) {
    showOptionError(type, result.message);
    render();
    return;
  }

  updateManualDraft(draftIndex, fieldKey, result.value);
  render();
}

function addManualDraftsToTracker() {
  if (!manualDrafts.length) {
    window.alert("Generate draft rows first.");
    return;
  }

  const validDrafts = manualDrafts.map(createTransactionRecord);
  transactions = [...transactions, ...validDrafts];
  saveTransactions();
  localStorage.setItem(MANUAL_IMPORT_STORAGE_KEY, document.getElementById("manualImportText").value);
  manualDrafts = [];
  document.getElementById("manualImportText").value = "";
  localStorage.removeItem(MANUAL_IMPORT_STORAGE_KEY);
  setActiveTab("records");
  render();
}
