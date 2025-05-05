
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CalculationResult, CalculationInputs } from "./calculations"; // Import CalculationInputs

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper function to safely escape CSV fields
function escapeCSV(field: string | number | null | undefined): string {
    if (field === null || field === undefined) {
        return '';
    }
    const stringField = String(field);
    // Escape double quotes by doubling them and wrap the field in double quotes if it contains commas, double quotes, or newlines
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}


// Function to convert array of objects to CSV string and trigger download
export function exportToCSV(
    resultsData: CalculationResult[],
    inputData: CalculationInputs,
    filename: string = 'disparity-results.csv'
) {
  const csvRows = [];

  // --- Input Parameters Section ---
  csvRows.push("Input Parameters"); // Section header
  csvRows.push(`Total Sample Size (N),${escapeCSV(inputData.N)}`);
  csvRows.push(`Significance Level (α),${escapeCSV(inputData.alpha)}`);
  csvRows.push(`Reference Category,${escapeCSV(inputData.referenceCategoryName)}`);
  csvRows.push(""); // Blank row for separation

  // --- Categories Section ---
  csvRows.push("Categories"); // Section header
  csvRows.push("Category Name,Count"); // Sub-headers
  inputData.categories.forEach(cat => {
    csvRows.push(`${escapeCSV(cat.name)},${escapeCSV(cat.count)}`);
  });
  csvRows.push(""); // Blank row for separation

  // --- Results Section ---
  csvRows.push("Calculation Results"); // Section header
   // Define CSV headers based on the updated table display
   const ciLevel = (1 - inputData.alpha) * 100;
  const resultsHeaders = [
    "Comparison Group",
    "Proportion (p)",
    "Difference (δ)",
    "Std. Error (SE)",
    "Z-Statistic",
    `${ciLevel}% CI Lower`, // Dynamic CI header part
    `${ciLevel}% CI Upper`, // Dynamic CI header part
    "Statistically Significant?",
    "Notes"
  ];
  csvRows.push(resultsHeaders.join(',')); // Header row for results


  // Helper to format numbers, handling NaN and potential undefined for results table
   const formatNumberForCSV = (num: number | undefined | null): string => {
       if (num === undefined || num === null || isNaN(num)) {
           return 'N/A';
       }
        // Handle Infinity cases for zStat
       if (num === Infinity) return 'Infinity';
       if (num === -Infinity) return '-Infinity';
       // Use enough precision for CSV
       return num.toFixed(6); // Increased precision for CSV export
   };

  // Convert each result object to a CSV row
  if (resultsData && resultsData.length > 0) {
      resultsData.forEach(row => {
        // Order matters, ensure it matches resultsHeaders
        const values = [
          escapeCSV(row.categoryName), // Use helper for escaping
          formatNumberForCSV(row.pi),
          formatNumberForCSV(row.delta),
          formatNumberForCSV(row.SE),
          formatNumberForCSV(row.zStat),
          formatNumberForCSV(row.ciLow), // Lower CI
          formatNumberForCSV(row.ciHigh), // Upper CI
          row.error ? 'Error' : (row.isSignificant ? 'Yes' : 'No'), // Simplified significance
          escapeCSV(row.error ?? '') // Use helper and handle potential undefined error
        ];
        csvRows.push(values.join(','));
      });
  } else {
     csvRows.push("No comparison results generated (or only errors occurred)."); // Indicate if no results
  }


  const csvString = csvRows.join('\n');

  // Create a Blob and trigger download
  const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel compatibility
  const link = document.createElement('a');
  if (link.download !== undefined) { // Feature detection
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up
  } else {
    console.error("CSV download not supported in this browser.");
    // Fallback or message to user - Consider adding a toast here too
    throw new Error("CSV download not supported."); // Throw error to be caught by handler
  }
}
