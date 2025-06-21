// Chart.js CDN is linked in HTML, so its global object 'Chart' is available.
// <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
// SheetJS (xlsx) is linked in HTML, so its global object 'XLSX' is available.
// <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>


let turnaroundTimeChartInstance = null; // To store Chart.js instance
let selectedMonthFilter = 'all'; // Default filter to show all months
let currentSearchQuery = ''; // Stores the current search query
let currentDisplayedItemsWithMetrics = []; // Stores the currently displayed and calculated items for download/overview

const LOCAL_STORAGE_KEY = 'turnaroundItems'; // Key for local storage

let editingItemId = null; // Stores the ID of the item currently being edited

const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Message Box function
function showMessageBox(message, isError = false) {
    const messageBox = document.getElementById('messageBox');
    messageBox.textContent = message;
    messageBox.className = 'message-box show'; // Reset classes
    if (isError) {
        messageBox.classList.add('error');
    } else {
        messageBox.classList.remove('error');
    }
    setTimeout(() => {
        messageBox.classList.remove('show');
    }, 3000); // Hide after 3 seconds
}

// Get references to DOM elements
const turnaroundForm = document.getElementById('turnaroundForm');
const itemsTableBody = document.getElementById('itemsTableBody');
const monthFilter = document.getElementById('monthFilter');
const itemSearchInput = document.getElementById('itemSearch'); // New search input
const downloadButton = document.getElementById('downloadButton'); // Changed from printButton
const submitButton = document.getElementById('submitButton');
const cancelEditButton = document.getElementById('cancelEditButton');

const totalRecordsSpan = document.getElementById('totalRecords');
const avgTurnaroundTimeSpan = document.getElementById('avgTurnaroundTime');
const avgActualEfficiencySpan = document.getElementById('avgActualEfficiency');
const metTargetCountSpan = document.getElementById('metTargetCount');
const belowTargetCountSpan = document.getElementById('belowTargetCount');
const chartCanvas = document.getElementById('turnaroundTimeChart');
const chartMessage = document.getElementById('chartMessage');

// Ensure chartCtx is only accessed after canvas element is guaranteed to exist
let chartCtx = null;
if (chartCanvas) {
    chartCtx = chartCanvas.getContext('2d');
} else {
    console.error("Chart canvas element not found!");
}


// --- Initialization for Local Storage ---
// Load items when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    loadTurnaroundItems();
});

/**
 * Populates the month filter dropdown with unique months from the provided items.
 * @param {Array<Object>} items - Array of item data.
 */
function populateMonthFilter(items) {
    const uniqueMonths = new Set();
    items.forEach(item => {
        if (item.dateTimeReceivedQC) {
            // Extract YYYY-MM from "YYYY-MM-DDTHH:MM"
            const yearMonth = item.dateTimeReceivedQC.substring(0, 7);
            uniqueMonths.add(yearMonth);
        }
    });

    // Clear existing options except "All Months"
    monthFilter.innerHTML = '<option value="all">All Months</option>';

    // Sort months chronologically
    const sortedMonths = Array.from(uniqueMonths).sort();

    sortedMonths.forEach(yearMonth => {
        const [year, monthNum] = yearMonth.split('-');
        const monthName = monthNames[parseInt(monthNum) - 1]; // Convert 1-indexed month to name
        const option = document.createElement('option');
        option.value = yearMonth;
        option.textContent = `${monthName} ${year}`;
        monthFilter.appendChild(option);
    });

    // Set the selected month in the dropdown
    monthFilter.value = selectedMonthFilter;
}

// Event listener for month filter change
monthFilter.addEventListener('change', (event) => {
    selectedMonthFilter = event.target.value;
    loadTurnaroundItems(); // Reload and re-process data with new filter
});

// Event listener for item search input
itemSearchInput.addEventListener('input', (event) => {
    currentSearchQuery = event.target.value.toLowerCase(); // Get current search query, convert to lowercase for case-insensitive search
    loadTurnaroundItems(); // Reload and re-process data with new search query
});


// Event listener for download button click
downloadButton.addEventListener('click', () => {
    downloadExcelReport();
});

// Event listener for cancel edit button
cancelEditButton.addEventListener('click', () => {
    clearFormAndEditState();
});

/**
 * Clears the form and resets the editing state.
 */
function clearFormAndEditState() {
    turnaroundForm.reset();
    submitButton.textContent = 'Add Item';
    cancelEditButton.classList.add('hidden');
    editingItemId = null;
}

/**
 * Populates the form fields with data from a selected item for editing.
 * @param {Object} item - The item object to populate the form with.
 */
function populateFormForEdit(item) {
    document.getElementById('itemDescription').value = item.itemDescription;
    document.getElementById('totalQty').value = item.totalQty;
    document.getElementById('tcnNumber').value = item.tcnNumber;
    document.getElementById('totalQtyInspected').value = item.totalQtyInspected;
    document.getElementById('dateTimeReceivedQC').value = item.dateTimeReceivedQC;
    document.getElementById('dateTimeQCStart').value = item.dateTimeQCStart;
    document.getElementById('dateTimeQCFinished').value = item.dateTimeQCFinished;
    document.querySelector(`input[name="assemblyRequired"][value="${item.assemblyRequired}"]`).checked = true;

    submitButton.textContent = 'Update Item';
    cancelEditButton.classList.remove('hidden');
    editingItemId = item.id; // Store the ID of the item being edited
}

/**
 * Handles deleting an item from Local Storage.
 * @param {number} itemIdToDelete - The ID of the item to delete.
 */
function deleteTurnaroundItem(itemIdToDelete) {
    let allItems = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    const initialLength = allItems.length;
    allItems = allItems.filter(item => item.id !== itemIdToDelete);

    if (allItems.length < initialLength) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allItems));
        showMessageBox("Item deleted successfully!");
        loadTurnaroundItems(); // Reload data to update all sections
    } else {
        showMessageBox("Item not found for deletion.", true);
    }
}


/**
 * Formats a datetime string (from input type="datetime-local") into a more readable format.
 * @param {string} dateTimeString - The datetime string from the input.
 * @returns {string} - Formatted date and time.
 */
function formatDateTime(dateTimeString) {
    if (!dateTimeString) return '';
    const date = new Date(dateTimeString);
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    return date.toLocaleString('en-US', options);
}

/**
 * Calculates metrics for a single item.
 * @param {Object} item - The item data object.
 * @returns {Object} - An object containing calculated metrics and their computation strings.
 */
function calculateItemMetrics(item) {
    let turnaroundTimeHours = 'N/A';
    let turnaroundTimeComputation = 'Requires both "Date & Time Received for QC" and "Date & Time QC Finished".';
    if (item.dateTimeReceivedQC && item.dateTimeQCFinished) {
        const receiveDate = new Date(item.dateTimeReceivedQC);
        const finishDate = new Date(item.dateTimeQCFinished);
        const diffMilliseconds = finishDate - receiveDate;
        if (diffMilliseconds >= 0) {
            turnaroundTimeHours = (diffMilliseconds / (1000 * 60 * 60)).toFixed(2);
            turnaroundTimeComputation = `Computed as (Date & Time QC Finished (${formatDateTime(item.dateTimeQCFinished)}) - Date & Time Received for QC (${formatDateTime(item.dateTimeReceivedQC)})) in hours.`;
        } else {
            turnaroundTimeComputation = "QC Finish Time is before QC Receive Time. Please check dates.";
        }
    }

    let targetProductivityHours = 'N/A';
    let targetEfficiencyComputation = 'Requires a valid "Turnaround Time (Hours)" calculation.';
    let roundedTargetProductivityHours = 'N/A';
    if (turnaroundTimeHours !== 'N/A' && !isNaN(parseFloat(turnaroundTimeHours))) {
        const calculatedTarget = parseFloat(turnaroundTimeHours) * 0.98;
        targetProductivityHours = calculatedTarget.toFixed(2);
        roundedTargetProductivityHours = Math.round(calculatedTarget);
        targetEfficiencyComputation = `Computed as Turnaround Time (${turnaroundTimeHours} hours) × 0.98 = ${targetProductivityHours} hours. This is a target duration reflecting 98% productivity for this specific turnaround, not a percentage goal for overall efficiency.`;
    }

    let actualEfficiency = 'N/A';
    let actualEfficiencyComputation = 'Requires valid "Turnaround Time (Hours)" and "Target Productivity Hours" calculations.';
    if (turnaroundTimeHours !== 'N/A' && !isNaN(parseFloat(turnaroundTimeHours)) &&
        roundedTargetProductivityHours !== 'N/A' && !isNaN(parseFloat(roundedTargetProductivityHours))) {
        if (parseFloat(turnaroundTimeHours) !== 0) {
            actualEfficiency = ((roundedTargetProductivityHours / parseFloat(turnaroundTimeHours)) * 100).toFixed(2);
            actualEfficiencyComputation = `Computed as (ROUND OFF Target Productivity Hours (${roundedTargetProductivityHours}) / TURNAROUND TIME (${turnaroundTimeHours})) × 100%. This reflects how closely the actual turnaround time aligns with its 98% productivity goal.`;
        } else {
            actualEfficiency = 'Error';
            actualEfficiencyComputation = 'Error: Turnaround Time is 0. Cannot divide by zero.';
        }
    }

    let efficiencyResult = 'N/A';
    const fixedEfficiencyTarget = 98;
    if (actualEfficiency !== 'N/A' && !isNaN(parseFloat(actualEfficiency))) {
        if (parseFloat(actualEfficiency) >= fixedEfficiencyTarget) {
            efficiencyResult = 'MET TARGET';
        } else {
            efficiencyResult = 'BELOW TARGET';
        }
    }

    return {
        turnaroundTimeHours,
        turnaroundTimeComputation,
        targetProductivityHours,
        targetEfficiencyComputation,
        actualEfficiency,
        actualEfficiencyComputation,
        efficiencyResult
    };
}

/**
 * Renders a single item row in the table.
 * @param {Object} item - The item data object.
 * @param {Object} metrics - Calculated metrics for the item.
 */
function renderItemRow(item, metrics) {
    const newRow = document.createElement('tr');
    newRow.setAttribute('data-id', item.id); // Use the item's unique ID

    const cells = [
        { value: item.itemDescription, title: '' },
        { value: item.totalQty, title: '' },
        { value: item.tcnNumber, title: '' },
        { value: item.totalQtyInspected, title: '' },
        { value: formatDateTime(item.dateTimeReceivedQC), title: '' },
        { value: formatDateTime(item.dateTimeQCStart), title: '' },
        { value: formatDateTime(item.dateTimeQCFinished), title: '' },
        { value: item.assemblyRequired, title: '' },
        { value: `${metrics.targetProductivityHours}`, title: metrics.targetEfficiencyComputation },
        { value: `${metrics.actualEfficiency}%`, title: metrics.actualEfficiencyComputation },
        { value: metrics.efficiencyResult, title: '' },
        { value: metrics.turnaroundTimeHours, title: metrics.turnaroundTimeComputation }
    ];

    cells.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell.value;
        if (cell.title) {
            td.setAttribute('title', cell.title);
        }
        newRow.appendChild(td);
    });

    // Add Actions column with Edit and Delete buttons
    const actionsTd = document.createElement('td');
    actionsTd.classList.add('no-print'); // Hide actions in print view
    const editButton = document.createElement('button');
    editButton.textContent = 'Edit';
    editButton.classList.add('bg-yellow-500', 'hover:bg-yellow-600', 'text-white', 'font-bold', 'py-1', 'px-3', 'rounded-md', 'text-xs', 'mr-2');
    // Pass the entire item object to populateFormForEdit
    editButton.addEventListener('click', () => populateFormForEdit(item));

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white', 'font-bold', 'py-1', 'px-3', 'rounded-md', 'text-xs');
    // Pass the item's unique ID to deleteTurnaroundItem
    deleteButton.addEventListener('click', () => deleteTurnaroundItem(item.id));

    actionsTd.appendChild(editButton);
    actionsTd.appendChild(deleteButton);
    newRow.appendChild(actionsTd);

    itemsTableBody.appendChild(newRow);
}

/**
 * Updates the QA Performance Overview section.
 * @param {Array<Object>} filteredItems - Array of filtered items with their calculated metrics.
 */
function updateQaOverview(filteredItems) {
    let totalTurnaroundTime = 0;
    let totalActualEfficiency = 0;
    let validTurnaroundTimeCount = 0;
    let validActualEfficiencyCount = 0;
    let metTargetCount = 0;
    let belowTargetCount = 0;

    filteredItems.forEach(item => {
        const metrics = calculateItemMetrics(item);

        if (metrics.turnaroundTimeHours !== 'N/A' && metrics.turnaroundTimeHours !== 'Error' && !isNaN(parseFloat(metrics.turnaroundTimeHours))) {
            totalTurnaroundTime += parseFloat(metrics.turnaroundTimeHours);
            validTurnaroundTimeCount++;
        }

        if (metrics.actualEfficiency !== 'N/A' && metrics.actualEfficiency !== 'Error' && !isNaN(parseFloat(metrics.actualEfficiency))) {
            totalActualEfficiency += parseFloat(metrics.actualEfficiency);
            validActualEfficiencyCount++;
        }

        if (metrics.efficiencyResult === 'MET TARGET') {
            metTargetCount++;
        } else if (metrics.efficiencyResult === 'BELOW TARGET') {
            belowTargetCount++;
        }
    });

    const avgTurnaround = validTurnaroundTimeCount > 0 ? (totalTurnaroundTime / validTurnaroundTimeCount).toFixed(2) : 'N/A';
    const avgEfficiency = validActualEfficiencyCount > 0 ? (totalActualEfficiency / validActualEfficiencyCount).toFixed(2) : 'N/A';

    totalRecordsSpan.textContent = filteredItems.length;
    avgTurnaroundTimeSpan.textContent = avgTurnaround !== 'N/A' ? `${avgTurnaround} hours` : 'N/A';
    avgActualEfficiencySpan.textContent = avgEfficiency !== 'N/A' ? `${avgEfficiency}%` : 'N/A';
    metTargetCountSpan.textContent = metTargetCount;
    belowTargetCountSpan.textContent = belowTargetCount;
}

/**
 * Updates the Turnaround Time Bar Chart.
 * @param {Array<Object>} filteredItems - Array of filtered items with their calculated metrics.
 */
function updateTurnaroundTimeChart(filteredItems) {
    // Destroy existing chart instance if it exists
    if (turnaroundTimeChartInstance) {
        turnaroundTimeChartInstance.destroy();
    }

    if (!chartCtx) {
        console.error("Chart context is not available. Cannot draw chart.");
        chartCanvas.style.display = 'none';
        chartMessage.classList.remove('hidden');
        return;
    }

    const chartLabels = [];
    const chartData = [];
    const backgroundColors = [];
    const borderColors = [];

    const hasData = filteredItems.some(item => item.turnaroundTimeHours !== 'N/A' && item.turnaroundTimeHours !== 'Error' && !isNaN(parseFloat(item.turnaroundTimeHours)));

    if (!hasData) {
        chartCanvas.style.display = 'none';
        chartMessage.classList.remove('hidden');
        return;
    } else {
        chartCanvas.style.display = 'block';
        chartMessage.classList.add('hidden');
    }

    const validItemsForChart = filteredItems.filter(item => item.turnaroundTimeHours !== 'N/A' && item.turnaroundTimeHours !== 'Error' && !isNaN(parseFloat(item.turnaroundTimeHours)));

    validItemsForChart.forEach((item, index) => {
        const itemLabel = item.itemDescription ? `${item.itemDescription.substring(0, 20)}${item.itemDescription.length > 20 ? '...' : ''} (#${index + 1})` : `Item #${index + 1}`;
        chartLabels.push(itemLabel);
        chartData.push(parseFloat(item.turnaroundTimeHours));

        if (item.efficiencyResult === 'MET TARGET') {
            backgroundColors.push('rgba(75, 192, 192, 0.6)');
            borderColors.push('rgba(75, 192, 192, 1)');
        } else if (item.efficiencyResult === 'BELOW TARGET') {
            backgroundColors.push('rgba(255, 99, 132, 0.6)');
            borderColors.push('rgba(255, 99, 132, 1)');
        } else {
            backgroundColors.push('rgba(200, 200, 200, 0.6)');
            borderColors.push('rgba(200, 200, 200, 1)');
        }
    });

    turnaroundTimeChartInstance = new Chart(chartCtx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Turnaround Time (Hours)',
                data: chartData,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Turnaround Time for Each Item',
                    font: {
                        size: 16
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += `${context.parsed.y} hours`;
                            }
                            const itemIndex = context.dataIndex;
                            const item = validItemsForChart[itemIndex];
                            const efficiency = item.actualEfficiency !== 'N/A' ? `${item.actualEfficiency}%` : 'N/A';
                            const result = item.efficiencyResult;
                            label += ` | Actual Efficiency: ${efficiency} | Result: ${result}`;
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Turnaround Time (Hours)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Item'
                    }
                }
            }
        }
    });
}

/**
 * Downloads the currently displayed data as an Excel (.xlsx) file.
 */
function downloadExcelReport() {
    if (currentDisplayedItemsWithMetrics.length === 0) {
        showMessageBox("No data to download.", true);
        return;
    }

    // Get table headers from the currently rendered table to ensure they match the displayed columns
    // Corrected: Select the table's thead element directly using its ID to avoid the NodeList.closest error.
    const tableHeaderRow = document.getElementById('itemsTableBody').previousElementSibling.querySelector('tr');
    const headerElements = tableHeaderRow.querySelectorAll('th');
    const headersForExcel = [];
    headerElements.forEach(th => {
        const headerText = th.textContent.trim();
        // Exclude the 'ACTIONS' header from the Excel export
        if (headerText !== 'ACTIONS') {
            headersForExcel.push(headerText);
        }
    });

    // Prepare data rows
    const dataForExcel = currentDisplayedItemsWithMetrics.map(item => {
        // Recalculate metrics to ensure the most up-to-date values are exported
        const metrics = calculateItemMetrics(item);

        return [
            item.itemDescription,
            item.totalQty,
            item.tcnNumber,
            item.totalQtyInspected,
            formatDateTime(item.dateTimeReceivedQC),
            formatDateTime(item.dateTimeQCStart),
            formatDateTime(item.dateTimeQCFinished),
            item.assemblyRequired,
            `${metrics.targetProductivityHours}`, // Target Efficiency (now productivity hours)
            `${metrics.actualEfficiency}%`,      // Actual Efficiency
            metrics.efficiencyResult,            // Efficiency Result
            metrics.turnaroundTimeHours          // Turnaround Time
        ];
    });

    const ws_data = [headersForExcel, ...dataForExcel];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    // Add basic column widths for better formatting in Excel
    const wscols = [
        {wch: 25}, // ITEM DESCRIPTION
        {wch: 10}, // TOTAL QTY.
        {wch: 15}, // TCN #
        {wch: 20}, // TOTAL QTY. INSPECTED
        {wch: 25}, // DATE & TIME RECEIVED FOR QC
        {wch: 25}, // DATE & TIME QC START
        {wch: 25}, // DATE & TIME QC FINISHED
        {wch: 15}, // ASSEMBLY REQUIRED
        {wch: 20}, // TARGET EFFICIENCY (98%)
        {wch: 20}, // ACTUAL EFFICIENCY
        {wch: 20}, // EFFICIENCY RESULT
        {wch: 20}  // TURNAROUND TIME (HOURS)
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Turnaround Report");

    // Generate and download the file
    XLSX.writeFile(wb, "Turnaround_Report.xlsx");
    showMessageBox("Report downloaded successfully!");
}


/**
 * Loads items from Local Storage, filters them, and updates all sections.
 */
function loadTurnaroundItems() {
    const storedItems = localStorage.getItem(LOCAL_STORAGE_KEY);
    const allItemsFromStorage = storedItems ? JSON.parse(storedItems) : [];

    itemsTableBody.innerHTML = ''; // Clear table before rendering
    let itemsToDisplay = [];

    // Sort all items by timestamp before filtering to maintain chronological order
    allItemsFromStorage.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Populate month filter based on all available data from local storage
    populateMonthFilter(allItemsFromStorage);

    // Apply filters
    itemsToDisplay = allItemsFromStorage.filter(item => {
        const matchesMonth = selectedMonthFilter === 'all' ||
                             (item.dateTimeReceivedQC && item.dateTimeReceivedQC.startsWith(selectedMonthFilter));
        const matchesSearch = currentSearchQuery === '' ||
                              (item.itemDescription && item.itemDescription.toLowerCase().includes(currentSearchQuery));
        return matchesMonth && matchesSearch;
    });

    // Render each item row and calculate metrics for each item in the filtered list
    const itemsWithCalculatedMetrics = [];
    if (itemsToDisplay.length === 0) { // If no items after filtering
         const noFilteredDataRow = document.createElement('tr');
         const noFilteredDataCell = document.createElement('td');
         noFilteredDataCell.colSpan = 13;
         noFilteredDataCell.textContent = `No items found matching the current filters.`;
         noFilteredDataCell.className = "text-center py-4 text-gray-500";
         noFilteredDataRow.appendChild(noFilteredDataCell);
         itemsTableBody.appendChild(noFilteredDataRow);
    } else {
        itemsToDisplay.forEach((item) => {
            const metrics = calculateItemMetrics(item);
            renderItemRow(item, metrics);
            itemsWithCalculatedMetrics.push({ ...item, ...metrics });
        });
    }

    // Cache the currently displayed and calculated items
    currentDisplayedItemsWithMetrics = itemsWithCalculatedMetrics;

    // Update the QA Performance Overview and Chart with filtered data
    updateQaOverview(itemsWithCalculatedMetrics);
    updateTurnaroundTimeChart(itemsWithCalculatedMetrics);
}

// Add event listener for form submission (Add/Update)
turnaroundForm.addEventListener('submit', async function(event) {
    event.preventDefault(); // Prevent default form submission

    const itemData = {
        itemDescription: document.getElementById('itemDescription').value,
        totalQty: parseInt(document.getElementById('totalQty').value),
        tcnNumber: document.getElementById('tcnNumber').value,
        totalQtyInspected: parseInt(document.getElementById('totalQtyInspected').value),
        dateTimeReceivedQC: document.getElementById('dateTimeReceivedQC').value,
        dateTimeQCStart: document.getElementById('dateTimeQCStart').value,
        dateTimeQCFinished: document.getElementById('dateTimeQCFinished').value,
        assemblyRequired: document.querySelector('input[name="assemblyRequired"]:checked').value,
    };

    try {
        const storedItems = localStorage.getItem(LOCAL_STORAGE_KEY);
        const allItems = storedItems ? JSON.parse(storedItems) : [];

        if (editingItemId) {
            // Update existing item
            const itemIndex = allItems.findIndex(item => item.id === editingItemId);
            if (itemIndex > -1) {
                // Merge old data with new form data, keeping original ID and timestamp
                allItems[itemIndex] = { ...allItems[itemIndex], ...itemData };
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allItems));
                showMessageBox("Item updated successfully!");
            } else {
                showMessageBox("Error: Item to update not found.", true);
            }
        } else {
            // Add new item
            itemData.id = Date.now(); // Generate a unique ID for new items
            itemData.timestamp = new Date().toISOString(); // Add timestamp for new items
            allItems.push(itemData);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allItems));
            showMessageBox("Item added successfully!");
        }
        clearFormAndEditState(); // Clear form and reset edit state after success
        loadTurnaroundItems(); // Reload data to update all sections
    } catch (e) {
        console.error("Error adding/updating item in local storage: ", e);
        showMessageBox("Error adding/updating item. Please try again.", true);
    }
});
