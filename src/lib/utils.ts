import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CalculationResult } from "./calculations"; // Assuming results interface is here

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


// Function to convert array of objects to CSV string and trigger download
export function exportToCSV(data: CalculationResult[], filename: string = 'disparity-results.csv') {
  if (!data || data.length === 0) {
    console.error("No data provided for CSV export.");
    return;
  }

  // Define CSV headers based on the CalculationResult interface keys
  const headers = [
    "Category",
    "p_i",
    "p_ref",
    "δ",
    "SE",
    "z",
    "CI_low",
    "CI_high",
    "Significant?",
    "Error" // Include error column
  ];

  const csvRows = [
    headers.join(',') // Header row
  ];

  // Convert each result object to a CSV row
  data.forEach(row => {
    // Order matters, ensure it matches headers
    const values = [
      `"${row.categoryName.replace(/"/g, '""')}"`, // Escape quotes in names
      row.pi.toFixed(4),
      row.pRef.toFixed(4),
      row.delta.toFixed(4),
      row.SE.toFixed(4),
      row.zStat.toFixed(4),
      row.ciLow.toFixed(4),
      row.ciHigh.toFixed(4),
      row.isSignificant ? 'Yes' : 'No',
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
