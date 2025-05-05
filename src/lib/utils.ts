import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CalculationResult } from "./calculations"; // Assuming results interface is here

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


// Function to convert array of objects to CSV string and trigger download
export function exportToCSV(data: CalculationResult[], filename: string = 'disparity-results.csv', referenceCategoryName?: string) {
  if (!data || data.length === 0) {
    console.error("No data provided for CSV export.");
    return;
  }

  // Define CSV headers based on the updated table display
  const headers = [
    "Comparison Group", // Changed Header
    "Proportion (p)", // Simplified Header
    "Difference (δ)",
    "Std. Error (SE)",
    "Z-Statistic",
    "Lower CI", // Keep separate for CSV clarity
    "Upper CI", // Keep separate for CSV clarity
    "Significant?",
    "Error" // Include error column
  ];

  // Helper to format numbers, handling NaN and potential undefined
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


  const csvRows = [
    headers.join(',') // Header row
  ];

  // Convert each result object to a CSV row
  data.forEach(row => {
    // Order matters, ensure it matches headers
    const values = [
      `"${row.categoryName.replace(/"/g, '""')}"`, // Escape quotes in names
      formatNumberForCSV(row.pi),
      formatNumberForCSV(row.delta),
      formatNumberForCSV(row.SE),
      formatNumberForCSV(row.zStat),
      formatNumberForCSV(row.ciLow), // Lower CI
      formatNumberForCSV(row.ciHigh), // Upper CI
      row.error ? 'Error' : (row.isSignificant ? 'Yes' : 'No'), // Simplified significance
      row.error ? `"${row.error.replace(/"/g, '""')}"` : '' // Escape quotes in errors
    ];
    csvRows.push(values.join(','));
  });

  const csvString = csvRows.join('\n');

  // Create a Blob and trigger download
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
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
    // Fallback or message to user
  }
}
