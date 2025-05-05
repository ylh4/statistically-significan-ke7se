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
    .refine(val => val >= 0.0000000001 && val <= 0.9999999999, { message: "Significance Level must be between 1E-10 and 0.9999999999" }) // Combined bounds check
    .default(0.05), // Provide default within the schema
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
  const [activeTab, setActiveTab] = useState<string>("input"); // Default tab


   const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      alpha: 0.05, // Default alpha explicitly set, Zod default also helps
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

  // Handler for Alpha input change
  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Let RHF and Zod handle the validation based on the schema
      form.setValue('alpha', e.target.value as any, { shouldValidate: true });
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
        alpha: data.alpha, // Use validated alpha
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
    form.reset(); // Reset to defaultValues defined in useForm
    setReportResults(null);
    setCalculationError(null);
     toast({
        title: "Form Reset",
        description: "All inputs and results have been cleared.",
     });
      setActiveTab("input"); // Switch back to input tab on reset
  };

 // Handle CSV Export - Uses updated exportToCSV
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
       // Pass both reportResults and the current form values (inputData)
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
     const reportElement = reportRef.current;
     if (!reportElement) {
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
       // Capture the specific div
        const canvas = await html2canvas(reportElement, {
             scale: 2, // Increase scale for better resolution
             useCORS: true,
             logging: false,
             backgroundColor: '#ffffff', // Set background to white explicitly
             // Try to capture full page content if possible, might need adjustments
             // windowWidth: reportElement.scrollWidth,
             // windowHeight: reportElement.scrollHeight,
        });

       const imgData = canvas.toDataURL('image/png');
       const pdf = new jsPDF({
           orientation: 'l', // landscape
           unit: 'pt',
           format: 'a4',
           putOnlyUsedFonts:true,
           floatPrecision: 16 // or "smart", default is 16
       });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;

        // Calculate the ratio to fit the image within the PDF page margins (e.g., 20pt margin)
        const margin = 40;
        const availableWidth = pdfWidth - margin * 2;
        const availableHeight = pdfHeight - margin * 2;

        const ratio = Math.min(availableWidth / imgWidth, availableHeight / imgHeight);

        const imgX = margin;
        const imgY = margin;
        const effectiveImgWidth = imgWidth * ratio;
        const effectiveImgHeight = imgHeight * ratio;


       pdf.addImage(imgData, 'PNG', imgX, imgY, effectiveImgWidth, effectiveImgHeight);

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
 const renderInterpretation = (p: number | null | undefined, alpha: number) => {
    if (p === null || p === undefined || isNaN(p)) return null; // Handle invalid p-values
    const isSignificant = p < alpha;
    return (
         <span className={cn("ml-2 text-xs italic", isSignificant ? "text-destructive font-semibold" : "text-muted-foreground")}>
             {isSignificant ? "Statistically different" : "Not statistically different"}
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
                                     {...form.register("alpha")}
                                     onChange={handleAlphaChange} // Use custom handler
                                     className={cn(form.formState.errors.alpha ? "border-destructive" : "")}
                                     // Add placeholder or default display if needed
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
                                                 onChange={() => { setReportResults(null); setCalculationError(null); }} // Clear results on name change too
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
                                                 onChange={() => { setReportResults(null); setCalculationError(null); form.trigger(`groups.${index}.experienced`); }} // Clear results and trigger validation
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
                                                  onChange={() => { setReportResults(null); setCalculationError(null); form.trigger(`groups.${index}.notExperienced`); }} // Clear results and trigger validation
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
                             <Button type="submit" disabled={!form.formState.isValid || form.formState.isSubmitting} className="bg-primary hover:bg-accent text-primary-foreground">
                                 <FileText className="mr-2 h-4 w-4" /> Generate Report
                             </Button>
                         </div>
                     </form>
                 </CardContent>
             </Card>
         </TabsContent>

         {/* Report Tab */}
         <TabsContent value="report">
              {/* Wrap content in a div with ref for PDF export */}
             <div ref={reportRef} className="bg-white p-4 rounded-md shadow"> {/* Ensure background for PDF */}
                 <Card className="w-full max-w-7xl mx-auto shadow-lg mt-4 border-none"> {/* Wider card, remove internal border if needed */}
                      <CardHeader className="flex flex-row justify-between items-center pb-2"> {/* Reduced bottom padding */}
                          <CardTitle className="text-2xl text-secondary-foreground">Statistical Report</CardTitle>
                          <div className="flex gap-2">
                             <Button
                                   type="button"
                                   variant="outline"
                                   onClick={handleExport}
                                   disabled={!reportResults}
                                   size="sm"
                               >
                                   <Download className="mr-2 h-4 w-4" /> Export CSV
                             </Button>
                             <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleExportPDF}
                                    disabled={!reportResults}
                                    size="sm"
                             >
                                    <FileDown className="mr-2 h-4 w-4" /> Export PDF
                              </Button>
                         </div>
                      </CardHeader>

                     <CardContent className="space-y-6 pt-4"> {/* Slightly reduced space */}
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
                                 <h3 className="text-lg font-semibold text-secondary-foreground mb-2">Contingency Table Summary</h3>
                                 <div className="overflow-x-auto rounded-md border">
                                     <Table>
                                          {/* Use custom dark header class */}
                                         <TableHeader className="table-header-dark">
                                             <TableRow className="hover:bg-table-header-bg/90">
                                                 <TableHead>Category (Race)</TableHead>
                                                 <TableHead className="text-right"># Did NOT Experience</TableHead>
                                                 <TableHead className="text-right"># Experienced</TableHead>
                                                 <TableHead className="text-right">Row Subtotal</TableHead>
                                                 <TableHead className="text-right">% Experienced</TableHead>
                                             </TableRow>
                                         </TableHeader>
                                         <TableBody>
                                             {reportResults.contingencySummary.map((row, index) => (
                                                  // Use custom alternating row class
                                                 <TableRow key={row.name} className={cn("table-row-alt", "hover:bg-muted/50")}>
                                                     <TableCell className="font-medium py-2 px-4">{row.name}</TableCell>
                                                      {/* Use custom tinted cell class */}
                                                     <TableCell className="text-right py-2 px-4 table-cell-tint">{row.notExperienced.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 table-cell-tint">{row.experienced.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 table-cell-tint">{row.rowTotal.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 table-cell-tint">{formatPercent(row.percentExperienced)}</TableCell>
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
                                  <h3 className="text-lg font-semibold text-secondary-foreground border-b pb-2 mb-3">Overall Test Results</h3>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                                     {/* Left Column */}
                                     <div className="space-y-2">
                                         <div className="flex justify-between">
                                             <span className="font-medium">Limit (Significance Level, α):</span>
                                             <span>{formatDecimal(reportResults.overallStats.limitAlpha, 4)}</span>
                                         </div>
                                         <div className="flex justify-between">
                                             <span className="font-medium">Degrees of Freedom:</span>
                                             <span>{reportResults.overallStats.degreesOfFreedom}</span>
                                         </div>
                                     </div>
                                      {/* Right Column */}
                                      <div className="space-y-2">
                                           <div className="flex justify-between">
                                               <span className="font-medium"># of Pairwise Comparisons:</span>
                                               <span>{reportResults.overallStats.numComparisons}</span>
                                           </div>
                                            {/* Placeholder for potential future additions */}
                                      </div>

                                      {/* Test Results Table */}
                                      <div className="col-span-1 sm:col-span-2 border-t pt-3 mt-2">
                                          <Table>
                                              <TableHeader>
                                                  <TableRow className="border-b-0">
                                                      <TableHead className="pl-0">Test</TableHead>
                                                      <TableHead className="text-right">Statistic</TableHead>
                                                      <TableHead className="text-right">P-Value</TableHead>
                                                      <TableHead className="text-right pr-0">Interpretation</TableHead>
                                                  </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                  {/* Chi-square */}
                                                  <TableRow className="hover:bg-transparent">
                                                      <TableCell className="font-medium pl-0 py-1">Chi-square</TableCell>
                                                      <TableCell className="text-right py-1">{formatDecimal(reportResults.overallStats.chiSquare.statistic)}</TableCell>
                                                      <TableCell className={cn("text-right py-1", reportResults.overallStats.chiSquare.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                          {formatScientific(reportResults.overallStats.chiSquare.pValue)}
                                                      </TableCell>
                                                       <TableCell className="text-right pr-0 py-1">
                                                           {renderInterpretation(reportResults.overallStats.chiSquare.pValue, reportResults.overallStats.limitAlpha)}
                                                       </TableCell>
                                                  </TableRow>
                                                  {/* Chi-square (Yates) */}
                                                   <TableRow className="hover:bg-transparent">
                                                      <TableCell className="font-medium pl-0 py-1">Chi-square (Yates)</TableCell>
                                                       <TableCell className="text-right py-1">{formatDecimal(reportResults.overallStats.chiSquareYates.statistic)}</TableCell>
                                                       <TableCell className={cn("text-right py-1", reportResults.overallStats.chiSquareYates.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                          {formatScientific(reportResults.overallStats.chiSquareYates.pValue)}
                                                      </TableCell>
                                                       <TableCell className="text-right pr-0 py-1">
                                                            {renderInterpretation(reportResults.overallStats.chiSquareYates.pValue, reportResults.overallStats.limitAlpha)}
                                                        </TableCell>
                                                  </TableRow>
                                                  {/* G-Test */}
                                                  <TableRow className="hover:bg-transparent">
                                                      <TableCell className="font-medium pl-0 py-1">G-Test</TableCell>
                                                      <TableCell className="text-right py-1">{formatDecimal(reportResults.overallStats.gTest.statistic)}</TableCell>
                                                      <TableCell className={cn("text-right py-1", reportResults.overallStats.gTest.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                          {formatScientific(reportResults.overallStats.gTest.pValue)}
                                                      </TableCell>
                                                       <TableCell className="text-right pr-0 py-1">
                                                          {renderInterpretation(reportResults.overallStats.gTest.pValue, reportResults.overallStats.limitAlpha)}
                                                      </TableCell>
                                                  </TableRow>
                                              </TableBody>
                                          </Table>
                                      </div>
                                  </div>
                             </div>
                         )}

                           {/* Phase 3: Pairwise Comparisons (Grouped by Reference Category) */}
                           {reportResults?.pairwiseResultsMatrix && groupNames.length > 0 && reportResults.overallStats && (
                               <div className="space-y-4">
                                   <h3 className="text-lg font-semibold text-secondary-foreground mb-2">
                                       Pairwise Chi-Square Comparisons with Bonferroni Correction
                                   </h3>
                                   <p className="text-xs text-muted-foreground">
                                       P-values corrected using Bonferroni method (critical α = {formatDecimal(reportResults.overallStats.limitAlpha / reportResults.overallStats.numComparisons, 4)}).
                                       Significant p-values (less than critical α) are highlighted in <span className="text-destructive font-semibold">red</span>.
                                   </p>

                                   {groupNames.map((referenceName) => (
                                       <div key={referenceName} className="space-y-2 p-4 border rounded-md bg-card">
                                           <h4 className="text-md font-semibold text-secondary-foreground">
                                               Comparisons Against: <span className="text-primary">{referenceName}</span>
                                           </h4>
                                           <div className="overflow-x-auto">
                                               <Table>
                                                   <TableHeader>
                                                       <TableRow className="border-b hover:bg-muted/50">
                                                           <TableHead className="pl-0">Comparison Category</TableHead>
                                                           <TableHead className="text-right pr-0">Corrected P-Value</TableHead>
                                                            <TableHead className="text-right pr-0">Interpretation</TableHead>
                                                       </TableRow>
                                                   </TableHeader>
                                                   <TableBody>
                                                       {groupNames
                                                            .filter(compareName => compareName !== referenceName) // Exclude self-comparison
                                                            .sort() // Optional: sort comparison categories alphabetically
                                                            .map((compareName) => {
                                                                const pValue = reportResults.pairwiseResultsMatrix?.[referenceName]?.[compareName];
                                                                const correctedAlpha = (reportResults.overallStats?.limitAlpha ?? 0.05) / (reportResults.overallStats?.numComparisons ?? 1);
                                                                const isSignificant = typeof pValue === 'number' && !isNaN(pValue) && pValue < correctedAlpha;

                                                                return (
                                                                    <TableRow key={`${referenceName}-vs-${compareName}`} className="hover:bg-muted/50">
                                                                        <TableCell className="font-medium pl-0 py-1">{compareName}</TableCell>
                                                                        <TableCell className={cn(
                                                                            "text-right pr-0 py-1",
                                                                            isSignificant ? 'text-destructive font-semibold' : 'text-gray-700'
                                                                        )}>
                                                                            {formatScientific(pValue)}
                                                                        </TableCell>
                                                                         <TableCell className="text-right pr-0 py-1">
                                                                            {renderInterpretation(pValue, correctedAlpha)}
                                                                         </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                   </TableBody>
                                               </Table>
                                           </div>
                                       </div>
                                   ))}
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