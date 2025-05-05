
"use client";

import type { FormEvent } from 'react'; // Removed ChangeEvent as RHF handles it
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { z } from "zod";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Select components are not used in the new version, can be removed if not needed elsewhere
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, PlusCircle, Download, RotateCcw, AlertCircle, FileDown, FileText, Info } from 'lucide-react'; // Added FileText, Info
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"; // Import Tabs
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // Import Tooltip components


import {
    performMultiComparisonReport,
    type MultiComparisonResults,
    type GroupInput,
    type ContingencySummaryData,
    type OverallTestStats,
    type PairwiseResultsMatrix,
    formatScientific,
    formatDecimal,
    formatPercent
} from "@/lib/calculations"; // Updated import
import { exportToCSV } from '@/lib/utils'; // Assuming exportToCSV is updated or will be
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

// --- Zod Schema Definition ---
// Updated Schema: No N, only alpha and categories with experienced/notExperienced
const groupSchema = z.object({
  name: z.string().min(1, "Category name cannot be empty"),
  experienced: z.coerce // Count of those experiencing the outcome
    .number({ invalid_type_error: "Experienced count must be a number" })
    .int("Experienced count must be an integer")
    .nonnegative("Experienced count cannot be negative"),
  notExperienced: z.coerce // Count of those NOT experiencing the outcome
    .number({ invalid_type_error: "Not Experienced count must be a number" })
    .int("Not Experienced count must be an integer")
    .nonnegative("Not Experienced count cannot be negative"),
});

const formSchema = z.object({
  alpha: z.coerce
    .number({ invalid_type_error: "Significance Level must be a number" })
    .positive("Significance Level must be positive") // Must be > 0
    .lt(1, "Significance Level must be less than 1") // Must be < 1
    .refine(val => val >= 0.0000000001, { message: "Significance Level too small" }) // Very small lower bound
    .refine(val => val <= 0.9999999999, { message: "Significance Level too large" }), // Very high upper bound
    // Default to 0.05 if empty or invalid, handled in component logic
  groups: z.array(groupSchema).min(2, "At least two categories are required"),
});


type FormValues = z.infer<typeof formSchema>;


// --- Component ---
export default function DisparityCalculator() {
  const { toast } = useToast();
  // State to hold the results from performMultiComparisonReport
  const [reportResults, setReportResults] = useState<MultiComparisonResults | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null); // Ref for PDF export area
  const [activeTab, setActiveTab] = useState<string>("report"); // Default tab


   const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      alpha: 0.05, // Default alpha
      groups: [ // Default groups
        { name: "Black or African American", experienced: 862, notExperienced: 7195 },
        { name: "Native Hawaiian or Other Pacific Islander", experienced: 3, notExperienced: 27 },
        { name: "American Indian or Alaska Native", experienced: 35, notExperienced: 339 },
        { name: "White or Caucasian", experienced: 1681, notExperienced: 17133 },
        { name: "Asian", experienced: 44, notExperienced: 534 },
        { name: "Other Race", experienced: 223, notExperienced: 3131 },
        { name: "Multiracial", experienced: 16, notExperienced: 294 },
        { name: "Unknown", experienced: 13, notExperienced: 294 },
      ],
    },
     mode: "onChange", // Validate on change
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "groups",
  });

  const watchAlpha = form.watch("alpha"); // Watch alpha for display/calculations

  // Handler for Alpha input change to ensure it stays within bounds and resets calculation
  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let newValue: number | null = parseFloat(e.target.value);

      if (isNaN(newValue) || newValue <= 0 || newValue >= 1) {
         // If invalid, keep the input field value as is but maybe show error,
         // or reset to default? Let's keep RHF state potentially invalid for Zod.
         form.setValue('alpha', e.target.value as any, { shouldValidate: true }); // Let Zod handle detailed validation
      } else {
         // Clamp value to practical bounds (adjust as needed)
         newValue = Math.max(0.0000000001, Math.min(0.9999999999, newValue));
         form.setValue('alpha', newValue, { shouldValidate: true });
      }
      // Clear results when alpha changes, as they become invalid
      setReportResults(null);
      setCalculationError(null);
  };


  // Main calculation submission handler
  const onSubmit = (data: FormValues) => {
    setCalculationError(null);
    setReportResults(null); // Clear previous results

    try {
      // Use the new calculation function
      const results = performMultiComparisonReport({
        alpha: data.alpha,
        groups: data.groups,
      });

      setReportResults(results); // Store the entire results object

       // Display errors from the calculation if any
        if (results.errors && results.errors.length > 0) {
            const errorMsg = results.errors.join('; ');
             setCalculationError(`Calculation completed with warnings: ${errorMsg}`);
             toast({
                 title: "Calculation Warning",
                 description: errorMsg,
                 variant: "destructive", // Use destructive variant for warnings too? Or custom?
                 duration: 10000, // Longer duration for warnings
             });
        } else {
            toast({
                title: "Calculation Successful",
                description: "Statistical report has been generated.",
            });
        }

         // Automatically switch to the report tab
         setActiveTab("report");

    } catch (error: any) {
      console.error("Calculation failed:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during calculation.";
      setCalculationError(errorMessage);
       toast({
            title: "Calculation Failed",
            description: errorMessage,
            variant: "destructive",
       });
    }
  };

  // Reset form and results
  const handleReset = () => {
    form.reset({ // Reset to the defined default values
        alpha: 0.05,
        groups: [
          { name: "Black or African American", experienced: 862, notExperienced: 7195 },
          { name: "Native Hawaiian or Other Pacific Islander", experienced: 3, notExperienced: 27 },
          { name: "American Indian or Alaska Native", experienced: 35, notExperienced: 339 },
          { name: "White or Caucasian", experienced: 1681, notExperienced: 17133 },
          { name: "Asian", experienced: 44, notExperienced: 534 },
          { name: "Other Race", experienced: 223, notExperienced: 3131 },
          { name: "Multiracial", experienced: 16, notExperienced: 294 },
          { name: "Unknown", experienced: 13, notExperienced: 294 },
        ],
    });
    setReportResults(null);
    setCalculationError(null);
     toast({
        title: "Form Reset",
        description: "All inputs and results have been cleared.",
     });
      setActiveTab("input"); // Switch back to input tab on reset
  };

  // Handle CSV Export - TODO: Update exportToCSV to handle the new report format
 const handleExport = () => {
     if (!reportResults || (!reportResults.contingencySummary && !reportResults.overallStats && !reportResults.pairwiseResultsMatrix)) {
          toast({
               title: "Export Failed",
               description: "No report data available to export.",
               variant: "destructive",
          });
         return;
     }
   try {
       // Assuming exportToCSV is updated to accept MultiComparisonResults
       // and format it appropriately. Needs implementation in utils.ts.
       exportToCSV(reportResults, form.getValues(), `statistical-report_${Date.now()}.csv`);
        toast({
           title: "Export Successful",
           description: "Report data exported to CSV.",
        });
   } catch (error) {
       console.error("CSV Export failed:", error);
        toast({
           title: "Export Failed",
           description: "Could not export data to CSV.",
           variant: "destructive",
        });
   }
 };

 // Handle PDF Export
 const handleExportPDF = async () => {
     if (!reportRef.current) {
          toast({
               title: "PDF Export Failed",
               description: "Report element not found.",
               variant: "destructive",
          });
         return;
     }
      if (!reportResults || (!reportResults.contingencySummary && !reportResults.overallStats && !reportResults.pairwiseResultsMatrix)) {
           toast({
                title: "PDF Export Failed",
                description: "No report data available to export.",
                variant: "destructive",
           });
          return;
      }

      // Ensure the report tab is active for capture
      if (activeTab !== 'report') {
          setActiveTab('report');
          // Wait a short moment for the tab content to render
          await new Promise(resolve => setTimeout(resolve, 200));
      }


      toast({
          title: "Generating PDF...",
          description: "Please wait while the report is being generated.",
      });

   try {
       // Ensure the content is fully rendered before capturing
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

       const canvas = await html2canvas(reportRef.current, {
            scale: 2,
            useCORS: true,
            logging: false, // Disable logging unless debugging
            // Try to capture background colors
            backgroundColor: null, // Use element's background or default white
       });
       const imgData = canvas.toDataURL('image/png');
       const pdf = new jsPDF({
           orientation: 'l', // landscape might be better for wide tables
           unit: 'pt',
           format: 'a4'
       });

       const pdfWidth = pdf.internal.pageSize.getWidth();
       const pdfHeight = pdf.internal.pageSize.getHeight();
       const imgWidth = canvas.width;
       const imgHeight = canvas.height;

       const ratio = Math.min((pdfWidth - 40) / imgWidth, (pdfHeight - 40) / imgHeight); // Add margin
       const imgX = (pdfWidth - imgWidth * ratio) / 2;
       const imgY = 20; // Top margin

       pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);

       const filename = `statistical-report_${Date.now()}.pdf`;
       pdf.save(filename);

       toast({
           title: "PDF Export Successful",
           description: `Report saved as ${filename}`,
       });

   } catch (error: any) {
       console.error("PDF Export failed:", error);
       toast({
           title: "PDF Export Failed",
           description: `Could not export report to PDF: ${error.message || 'Unknown error'}`,
           variant: "destructive",
       });
   }
 };

 const groupNames = useMemo(() => reportResults?.contingencySummary.map(g => g.name) ?? [], [reportResults]);


 // Helper to render the interpretation text with icon
 const renderInterpretation = (text: string | undefined) => {
     if (!text) return null;
     const isSignificant = text.toLowerCase().includes("statistically different");
     return (
         <span className={cn("ml-2 text-xs italic", isSignificant ? "text-destructive" : "text-muted-foreground")}>
             {text}
         </span>
     );
 };

 return (
     <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
         <TabsList className="grid w-full grid-cols-2">
             <TabsTrigger value="input">Input Parameters</TabsTrigger>
             <TabsTrigger value="report" disabled={!reportResults}>Statistical Report</TabsTrigger>
         </TabsList>

         {/* Input Tab */}
         <TabsContent value="input">
             <Card className="w-full max-w-5xl mx-auto shadow-lg mt-4">
                 <Toaster />
                 <CardHeader>
                     {/* Keep title consistent or adjust */}
                     <CardTitle className="text-2xl text-secondary-foreground">Input Parameters</CardTitle>
                 </CardHeader>
                 <CardContent>
                     <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                         {/* Alpha Input */}
                         <div className="space-y-2 max-w-xs"> {/* Limit width */}
                             <Label htmlFor="alpha">Significance Level (α)</Label>
                             <div className="flex items-center gap-2">
                                 <Input
                                     id="alpha"
                                     type="number"
                                     step="any" // Allow any step for flexible input
                                     min="0.0000000001" // Browser hint, Zod enforces
                                     max="0.9999999999" // Browser hint, Zod enforces
                                     {...form.register("alpha")}
                                     onChange={handleAlphaChange} // Use custom handler
                                     className={cn(form.formState.errors.alpha ? "border-destructive" : "")}
                                 />
                                 <TooltipProvider>
                                     <Tooltip>
                                         <TooltipTrigger asChild>
                                             <span className="text-sm text-muted-foreground cursor-default flex items-center gap-1">
                                                 <Info className="h-4 w-4" />
                                                 (Default: 0.05)
                                             </span>
                                         </TooltipTrigger>
                                         <TooltipContent>
                                             <p>Enter a value between 0 and 1 (e.g., 0.05 for 5%).</p>
                                         </TooltipContent>
                                     </Tooltip>
                                 </TooltipProvider>
                             </div>
                             {form.formState.errors.alpha && <p className="text-sm text-destructive">{form.formState.errors.alpha.message}</p>}
                         </div>

                         {/* Categories/Groups Section */}
                         <div className="space-y-4">
                             <Label className="text-lg font-medium text-secondary-foreground">Categories (Groups)</Label>
                             {fields.map((field, index) => (
                                 <div key={field.id} className="flex items-start gap-2 p-3 border rounded-md bg-card">
                                     <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                         {/* Name */}
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.name`}>Name</Label>
                                             <Input
                                                 id={`groups.${index}.name`}
                                                 {...form.register(`groups.${index}.name`)}
                                                 className={cn(form.formState.errors.groups?.[index]?.name ? "border-destructive" : "")}
                                             />
                                             {form.formState.errors.groups?.[index]?.name && <p className="text-sm text-destructive">{form.formState.errors.groups?.[index]?.name?.message}</p>}
                                         </div>
                                         {/* Experienced Count */}
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.experienced`}># Experienced Outcome</Label>
                                             <Input
                                                 id={`groups.${index}.experienced`}
                                                 type="number"
                                                 min="0"
                                                 step="1"
                                                 {...form.register(`groups.${index}.experienced`)}
                                                 className={cn(form.formState.errors.groups?.[index]?.experienced ? "border-destructive" : "")}
                                                 onChange={() => { setReportResults(null); setCalculationError(null); }} // Clear results on count change
                                             />
                                             {form.formState.errors.groups?.[index]?.experienced && <p className="text-sm text-destructive">{form.formState.errors.groups?.[index]?.experienced?.message}</p>}
                                         </div>
                                         {/* Not Experienced Count */}
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.notExperienced`}># Did Not Experience</Label>
                                             <Input
                                                 id={`groups.${index}.notExperienced`}
                                                 type="number"
                                                 min="0"
                                                 step="1"
                                                 {...form.register(`groups.${index}.notExperienced`)}
                                                 className={cn(form.formState.errors.groups?.[index]?.notExperienced ? "border-destructive" : "")}
                                                  onChange={() => { setReportResults(null); setCalculationError(null); }} // Clear results on count change
                                             />
                                             {form.formState.errors.groups?.[index]?.notExperienced && <p className="text-sm text-destructive">{form.formState.errors.groups?.[index]?.notExperienced?.message}</p>}
                                         </div>
                                     </div>
                                     <Button
                                         type="button"
                                         variant="ghost"
                                         size="icon"
                                         onClick={() => { remove(index); setReportResults(null); setCalculationError(null); }} // Clear results on remove
                                         disabled={fields.length <= 2}
                                         className="mt-6 text-destructive hover:bg-destructive/10 disabled:text-muted-foreground disabled:hover:bg-transparent"
                                         aria-label="Remove category"
                                     >
                                         <Trash2 className="h-4 w-4" />
                                     </Button>
                                 </div>
                             ))}
                             <Button
                                 type="button"
                                 variant="outline"
                                 onClick={() => { append({ name: `Group ${String.fromCharCode(65 + fields.length)}`, experienced: 0, notExperienced: 0 }); setReportResults(null); setCalculationError(null); }} // Clear results on add
                                 className="mt-2"
                             >
                                 <PlusCircle className="mr-2 h-4 w-4" /> Add Category
                             </Button>
                             {form.formState.errors.groups?.root && <p className="text-sm text-destructive">{form.formState.errors.groups.root.message}</p>}
                             {form.formState.errors.groups && typeof form.formState.errors.groups.message === 'string' && !form.formState.errors.groups.root && <p className="text-sm text-destructive">{form.formState.errors.groups.message}</p>}
                         </div>

                         {/* Action Buttons */}
                         <div className="flex flex-col sm:flex-row justify-end gap-4 pt-4">
                             <Button type="button" variant="outline" onClick={handleReset}>
                                 <RotateCcw className="mr-2 h-4 w-4" /> Reset Form
                             </Button>
                             <Button type="submit" disabled={!form.formState.isValid} className="bg-primary hover:bg-accent text-primary-foreground">
                                 <FileText className="mr-2 h-4 w-4" /> Generate Report
                             </Button>
                         </div>
                     </form>
                 </CardContent>
             </Card>
         </TabsContent>

         {/* Report Tab */}
         <TabsContent value="report">
             <div ref={reportRef} className="p-1"> {/* Add padding to ref for PDF capture */}
                 <Card className="w-full max-w-7xl mx-auto shadow-lg mt-4"> {/* Wider card for report */}
                      <CardHeader className="flex flex-row justify-between items-center">
                          <CardTitle className="text-2xl text-secondary-foreground">Statistical Report</CardTitle>
                          <div className="flex gap-2">
                             <Button
                                   type="button"
                                   variant="outline"
                                   onClick={handleExport}
                                   disabled={!reportResults}
                               >
                                   <Download className="mr-2 h-4 w-4" /> Export CSV
                             </Button>
                             <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleExportPDF}
                                    disabled={!reportResults}
                             >
                                    <FileDown className="mr-2 h-4 w-4" /> Export PDF
                              </Button>
                         </div>
                      </CardHeader>

                     <CardContent className="space-y-8 pt-4">
                         {calculationError && (
                             <Alert variant="destructive" className="w-full mb-4">
                                 <AlertCircle className="h-4 w-4" />
                                 <AlertTitle>Calculation Error/Warning</AlertTitle>
                                 <AlertDescription>{calculationError}</AlertDescription>
                             </Alert>
                         )}

                         {/* Phase 1: Contingency Table Summary */}
                         {reportResults?.contingencySummary && reportResults.contingencySummary.length > 0 && (
                             <div className="space-y-2">
                                 <h3 className="text-lg font-semibold text-secondary-foreground">Contingency Table Summary</h3>
                                 <div className="overflow-x-auto rounded-md border">
                                     <Table>
                                         <TableHeader className="bg-secondary">
                                             <TableRow className="bg-gray-800 hover:bg-gray-700"> {/* Dark Header */}
                                                 <TableHead className="text-white">Category (Race)</TableHead>
                                                 <TableHead className="text-right text-white"># Did NOT Experience</TableHead>
                                                 <TableHead className="text-right text-white"># Experienced</TableHead>
                                                 <TableHead className="text-right text-white">Row Subtotal</TableHead>
                                                 <TableHead className="text-right text-white">% Experienced</TableHead>
                                             </TableRow>
                                         </TableHeader>
                                         <TableBody>
                                             {reportResults.contingencySummary.map((row, index) => (
                                                 <TableRow key={row.name} className={cn(index % 2 === 0 ? "bg-gray-100" : "bg-white", "hover:bg-muted/50")}> {/* Alternating Row Colors */}
                                                     <TableCell className="font-medium py-2 px-4">{row.name}</TableCell>
                                                      {/* Apply tint to data columns */}
                                                     <TableCell className="text-right py-2 px-4 bg-orange-50">{row.notExperienced.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 bg-orange-50">{row.experienced.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 bg-orange-50">{row.rowTotal.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 bg-orange-50">{formatPercent(row.percentExperienced)}</TableCell>
                                                 </TableRow>
                                             ))}
                                         </TableBody>
                                     </Table>
                                 </div>
                             </div>
                         )}

                         {/* Phase 2: Overall Tests Results Box */}
                         {reportResults?.overallStats && (
                             <div className="space-y-4 p-4 border rounded-md bg-card">
                                  <h3 className="text-lg font-semibold text-secondary-foreground border-b pb-2">Overall Test Results</h3>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                                     {/* Left Column */}
                                     <div className="space-y-2">
                                         <div className="flex justify-between">
                                             <span className="font-medium">Limit (Significance Level, α):</span>
                                              {/* Alpha might need adjustment if user changes it after calculation */}
                                             <span>{formatDecimal(reportResults.overallStats.limitAlpha, 4)}</span>
                                         </div>
                                         <div className="flex justify-between">
                                             <span className="font-medium">Degrees of Freedom:</span>
                                             <span>{reportResults.overallStats.degreesOfFreedom}</span>
                                         </div>
                                         <div className="flex justify-between">
                                             <span className="font-medium"># of Pairwise Comparisons:</span>
                                             <span>{reportResults.overallStats.numComparisons}</span>
                                         </div>
                                     </div>
                                      {/* Right Column - Placeholder or can add more overall stats */}
                                      <div></div>

                                      {/* Test Results */}
                                      {/* Chi-square */}
                                      <div className="col-span-1 sm:col-span-2 border-t pt-3 mt-2 space-y-1">
                                          <div className="flex justify-between">
                                               <span className="font-medium">Chi-square Test Statistic:</span>
                                               <span>{formatDecimal(reportResults.overallStats.chiSquare.statistic)}</span>
                                          </div>
                                          <div className="flex justify-between items-center">
                                              <span className="font-medium">Chi-square P-Value:</span>
                                               <span className={cn(reportResults.overallStats.chiSquare.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                  {formatScientific(reportResults.overallStats.chiSquare.pValue)}
                                              </span>
                                          </div>
                                           <div className="text-right">
                                               {renderInterpretation(reportResults.overallStats.chiSquare.interpretation)}
                                           </div>
                                      </div>

                                      {/* Chi-square (Yates) */}
                                       <div className="col-span-1 sm:col-span-2 border-t pt-3 mt-2 space-y-1">
                                           <div className="flex justify-between">
                                               <span className="font-medium">Chi-square (Yates) Test Statistic:</span>
                                                <span>{formatDecimal(reportResults.overallStats.chiSquareYates.statistic)}</span>
                                           </div>
                                           <div className="flex justify-between items-center">
                                                <span className="font-medium">Chi-square (Yates) P-Value:</span>
                                                <span className={cn(reportResults.overallStats.chiSquareYates.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                   {formatScientific(reportResults.overallStats.chiSquareYates.pValue)}
                                               </span>
                                           </div>
                                           <div className="text-right">
                                                {renderInterpretation(reportResults.overallStats.chiSquareYates.interpretation)}
                                            </div>
                                       </div>

                                       {/* G-Test */}
                                       <div className="col-span-1 sm:col-span-2 border-t pt-3 mt-2 space-y-1">
                                           <div className="flex justify-between">
                                               <span className="font-medium">G-Test Statistic:</span>
                                                <span>{formatDecimal(reportResults.overallStats.gTest.statistic)}</span>
                                           </div>
                                           <div className="flex justify-between items-center">
                                                <span className="font-medium">G-Test P-Value:</span>
                                               <span className={cn(reportResults.overallStats.gTest.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                    {formatScientific(reportResults.overallStats.gTest.pValue)}
                                                </span>
                                           </div>
                                            <div className="text-right">
                                                {renderInterpretation(reportResults.overallStats.gTest.interpretation)}
                                            </div>
                                       </div>
                                  </div>
                             </div>
                         )}


                         {/* Phase 3: Pairwise Comparisons Matrix */}
                         {reportResults?.pairwiseResultsMatrix && groupNames.length > 0 && reportResults.overallStats && (
                             <div className="space-y-2">
                                 <h3 className="text-lg font-semibold text-secondary-foreground">P-Values of Pairwise Chi-Square Comparisons with Bonferroni Correction</h3>
                                 <div className="overflow-x-auto rounded-md border">
                                     <Table className="min-w-full divide-y divide-gray-200">
                                          <TableHeader className="bg-gray-800">
                                             <TableRow className="hover:bg-gray-700">
                                                 <TableHead className="py-2 px-3 text-left text-xs font-medium text-white uppercase tracking-wider sticky left-0 bg-gray-800 z-10">Comparison</TableHead> {/* Sticky Header */}
                                                 {groupNames.map(colName => (
                                                     <TableHead key={colName} className="py-2 px-3 text-center text-xs font-medium text-white uppercase tracking-wider whitespace-nowrap">{colName}</TableHead>
                                                 ))}
                                             </TableRow>
                                         </TableHeader>
                                         <TableBody className="bg-white divide-y divide-gray-200">
                                             {groupNames.map((rowName) => (
                                                 <TableRow key={rowName} className="hover:bg-gray-50">
                                                     <TableCell className="py-2 px-3 text-sm font-medium text-gray-900 whitespace-nowrap sticky left-0 bg-white z-10">{rowName}</TableCell> {/* Sticky Cell */}
                                                     {groupNames.map((colName) => {
                                                          const pValue = reportResults.pairwiseResultsMatrix?.[rowName]?.[colName];
                                                          const isSignificant = typeof pValue === 'number' && !isNaN(pValue) && pValue < (reportResults.overallStats?.limitAlpha ?? 0.05);
                                                          const isDiagonal = rowName === colName;
                                                          const isEmptyCell = typeof pValue !== 'number' || isNaN(pValue) || groupNames.indexOf(rowName) > groupNames.indexOf(colName); // Only fill upper triangle + diagonal

                                                          return (
                                                               <TableCell
                                                                   key={`${rowName}-${colName}`}
                                                                   className={cn(
                                                                       "py-2 px-3 text-sm text-center whitespace-nowrap",
                                                                        isSignificant ? 'text-destructive font-semibold' : 'text-gray-700',
                                                                        isDiagonal ? 'bg-gray-200' : '', // Style diagonal
                                                                        isEmptyCell && !isDiagonal ? 'bg-gray-50' : '', // Style lower triangle differently
                                                                   )}
                                                               >
                                                                  {isEmptyCell && !isDiagonal ? '' : formatScientific(pValue)}
                                                               </TableCell>
                                                          );
                                                      })}
                                                 </TableRow>
                                             ))}
                                         </TableBody>
                                     </Table>
                                 </div>
                                 <p className="text-xs text-muted-foreground pt-1">
                                     P-values are corrected using Bonferroni method (α = {formatDecimal(reportResults.overallStats.limitAlpha, 4)}).
                                     Significant p-values (less than α) are highlighted in <span className="text-destructive font-semibold">red</span>.
                                     Diagonal represents self-comparison (p=1.0). Lower triangle is omitted for symmetry.
                                 </p>
                             </div>
                         )}

                         {!reportResults && !calculationError && (
                             <p className="text-center text-muted-foreground">Generate a report to see the results here.</p>
                         )}
                     </CardContent>
                 </Card>
             </div> {/* End of reportRef div */}
         </TabsContent>
     </Tabs>
 );
}

// Helper function to safely get values from the report - Can be expanded
function getReportValue<T>(data: MultiComparisonResults | null, path: string, defaultValue: T): T {
    if (!data) return defaultValue;
    const keys = path.split('.');
    let current: any = data;
    for (const key of keys) {
        if (current === null || current === undefined || !current.hasOwnProperty(key)) {
            return defaultValue;
        }
        current = current[key];
    }
    return current !== undefined ? current : defaultValue;
}
