
"use client";

import type { FormEvent } from 'react';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { z } from "zod";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// import { Checkbox } from "@/components/ui/checkbox"; // No longer needed
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, PlusCircle, Download, RotateCcw, AlertCircle, FileDown, FileText, Info } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// import { ScrollArea } from "@/components/ui/scroll-area"; // No longer needed for checkbox list
import Link from 'next/link';


import {
    performMultiComparisonReport,
    type MultiComparisonResults,
    type GroupInput,
    type ContingencySummaryData,
    type OverallTestStats,
    type PairwiseResultsMatrix,
    type ContributionDetail,
    formatScientific,
    formatDecimal,
    formatPercent
} from "@/lib/calculations";
import { exportToCSV, type ExportFormValues } from '@/lib/utils';
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";


// --- Zod Schema Definition ---
const groupSchema = z.object({
  name: z.string().min(1, "Category name cannot be empty"),
  experienced: z.coerce
    .number({ invalid_type_error: "Experienced count must be a number" })
    .int("Experienced count must be an integer")
    .nonnegative("Experienced count cannot be negative"),
  notExperienced: z.coerce
    .number({ invalid_type_error: "Not Experienced count must be a number" })
    .int("Not Experienced count must be an integer")
    .nonnegative("Not Experienced count cannot be negative"),
});

const formSchema = z.object({
  alpha: z.coerce
    .number({ invalid_type_error: "Significance Level must be a number" })
    .positive("Significance Level must be positive")
    .lte(1, "Significance Level must be less than or equal to 1")
    .refine(val => val > 0, { message: "Significance Level must be greater than 0" })
    .default(0.05),
  groups: z.array(groupSchema).min(2, "At least two categories are required"),
  // referenceCategories: z.array(z.string()).min(1, "At least one reference category must be selected"), // Removed
});
// Removed .refine for referenceCategories

type FormValues = z.infer<typeof formSchema>;


// --- Component ---
export default function DisparityCalculator() {
  const { toast } = useToast();
  const [reportResults, setReportResults] = useState<MultiComparisonResults | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<string>("input");

  const defaultGroups: GroupInput[] = [];

   const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      alpha: 0.05,
      groups: defaultGroups,
      // referenceCategories: [], // Removed
    },
     mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "groups",
  });

  const groupFields = form.watch('groups');
  const groupNames = useMemo(() => groupFields.map(g => g.name).filter(name => name.trim() !== ''), [groupFields]);


  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      let numValue: number | null = parseFloat(value);

        if (!isNaN(numValue)) {
             numValue = Math.max(0.00000001, Math.min(numValue, 1));
            form.setValue('alpha', numValue, { shouldValidate: true });
        } else if (value === '') {
             form.setValue('alpha', null as any, { shouldValidate: true });
        } else {
             form.setValue('alpha', value as any, { shouldValidate: true });
        }

       form.trigger('alpha').then(isValid => {
            if (isValid && reportResults) {
                 const currentData = form.getValues();
                 const alphaValue = currentData.alpha === null ? 0.05 : currentData.alpha;
                 if (currentData.groups.length >= 2) { // Check only for groups
                     onSubmit({...currentData, alpha: alphaValue } as FormValues);
                 } else {
                     setReportResults(null);
                      setCalculationError("Recalculation skipped: Group requirements not met.");
                 }
            } else if (!reportResults) {
                setCalculationError(null);
            } else {
                 setCalculationError(form.formState.errors.alpha?.message || null);
            }
       });
  };

  useEffect(() => {
    // Auto-generate a unique name if possible when a new group is added and name is empty
    fields.forEach((field, index) => {
      if (!field.name || field.name.trim() === "") {
        let newName = `Group ${index + 1}`;
        let suffix = 1;
        const existingNames = form.getValues('groups').map(g => g.name).filter(Boolean);
        while (existingNames.includes(newName)) {
          newName = `Group ${index + 1}-${suffix++}`;
        }
        form.setValue(`groups.${index}.name`, newName, { shouldValidate: false }); // Don't validate immediately
      }
    });
  }, [fields, form]);


  const onSubmit = (data: FormValues) => {
    setCalculationError(null);
    setReportResults(null);

    try {
      const results = performMultiComparisonReport({
        alpha: data.alpha ?? 0.05,
        groups: data.groups,
      });

      setReportResults(results);

        if (results.errors && results.errors.length > 0) {
            const criticalErrors = results.errors.filter(e => !e.toLowerCase().includes('warning:'));
            const warningErrors = results.errors.filter(e => e.toLowerCase().includes('warning:'));

             if (criticalErrors.length > 0) {
                const errorMsg = criticalErrors.join('; ');
                 setCalculationError(`Calculation failed: ${errorMsg}`);
                 toast({
                     title: "Calculation Failed",
                     description: errorMsg,
                     variant: "destructive",
                     duration: 10000,
                 });
                 setActiveTab("input");
             } else if (warningErrors.length > 0) {
                 const warningMsg = warningErrors.join('; ');
                  setCalculationError(`${warningMsg}`);
                  toast({
                      title: "Calculation Warning",
                      description: warningMsg,
                      variant: "default",
                      className: "border-yellow-500/50 text-yellow-700 dark:border-yellow-600/60 dark:text-yellow-300 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400",
                      duration: 7000,
                  });
                  setActiveTab("report");
             } else {
                 toast({
                     title: "Calculation Successful",
                     description: "Statistical report has been generated.",
                 });
                  setActiveTab("report");
             }

        } else {
            toast({
                title: "Calculation Successful",
                description: "Statistical report has been generated.",
            });
             setActiveTab("report");
        }

    } catch (error: any) {
      console.error("Calculation failed:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during calculation.";
      setCalculationError(errorMessage);
       toast({
            title: "Calculation Failed",
            description: errorMessage,
            variant: "destructive",
       });
        setActiveTab("input");
    }
  };

  const handleReset = () => {
     form.reset({
        alpha: 0.05,
        groups: defaultGroups,
     });
    setReportResults(null);
    setCalculationError(null);
     toast({
        title: "Form Reset",
        description: "All inputs and results have been cleared.",
     });
      setActiveTab("input");
  };

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
       exportToCSV(reportResults, form.getValues() as ExportFormValues, `statistical-report_${Date.now()}.csv`);
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

      if (activeTab !== 'report') {
          setActiveTab('report');
          await new Promise(resolve => setTimeout(resolve, 200));
      }

      const currentReportElement = reportRef.current;
       if (!currentReportElement) {
          toast({
               title: "PDF Export Failed",
               description: "Report element not found after tab switch.",
               variant: "destructive",
          });
         return;
     }

      toast({
          title: "Generating PDF...",
          description: "Please wait while the report is being generated.",
      });

   try {
        const canvas = await html2canvas(currentReportElement, {
             scale: 2,
             useCORS: true,
             logging: false,
             backgroundColor: '#ffffff',
              scrollX: 0,
              scrollY: 0,
              windowWidth: currentReportElement.scrollWidth,
              windowHeight: currentReportElement.scrollHeight,
        });

       const imgData = canvas.toDataURL('image/png');
       const pdf = new jsPDF({
           orientation: 'p',
           unit: 'pt',
           format: 'a4',
           putOnlyUsedFonts:true,
           floatPrecision: 16
       });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;

        const margin = 40;
        const availableWidth = pdfWidth - margin * 2;
        const availableHeight = pdfHeight - margin * 2;

        const widthRatio = availableWidth / imgWidth;
        const heightRatio = availableHeight / imgHeight;
        const ratio = Math.min(widthRatio, heightRatio);

        const effectiveImgWidth = imgWidth * ratio;
        const effectiveImgHeight = imgHeight * ratio;
         const imgX = margin + (availableWidth - effectiveImgWidth) / 2;
         const imgY = margin;

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

 const currentAlpha = form.watch('alpha');

  const renderInterpretation = (
    p: number | null | undefined,
    alpha: number,
    isBonferroni: boolean = false
  ) => {
    if (p === null || p === undefined || isNaN(p)) return <span className="text-xs italic text-muted-foreground">N/A</span>;

    const isSignificant = p < alpha;
    const interpretationText = isSignificant
        ? "Statistically different."
        : "Not statistically different.";

    const followUpText = isSignificant
        ? " Potential disparity; pursue further investigation."
        : "";

    const fullText = interpretationText + followUpText;

    return (
         <span className={cn("ml-2 text-xs italic", isSignificant ? "text-destructive font-semibold" : "text-muted-foreground")}>
              {fullText}
         </span>
     );
 };


 return (
     <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
         <TabsList className="grid w-full grid-cols-2">
             <TabsTrigger value="input">Input Parameters</TabsTrigger>
             <TabsTrigger value="report" disabled={!reportResults}>Statistical Report</TabsTrigger>
         </TabsList>

         <TabsContent value="input">
             <Card className="w-full max-w-5xl mx-auto shadow-lg mt-4">
                 <CardHeader>
                      <div className="flex justify-between items-center">
                           <CardTitle className="text-2xl text-secondary-foreground">Input Parameters</CardTitle>
                           <Link href="/readme" passHref>
                              <Button variant="outline" size="sm">
                                  <Info className="mr-2 h-4 w-4" /> About
                              </Button>
                           </Link>
                      </div>
                 </CardHeader>
                 <CardContent>
                     <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                         <div className="space-y-2 max-w-xs">
                             <Label htmlFor="alpha">Significance Level (α)</Label>
                             <div className="flex items-center gap-2">
                                 <Input
                                     id="alpha"
                                     type="number"
                                     step="any"
                                     min="0.00000001"
                                     max="1"
                                      value={form.watch('alpha') ?? ''}
                                     onChange={handleAlphaChange}
                                     onBlur={() => form.trigger('alpha')}
                                     className={cn("border", form.formState.errors.alpha ? "border-destructive" : "border-input")}
                                     placeholder="e.g., 0.05"
                                 />
                                 <TooltipProvider>
                                     <Tooltip>
                                         <TooltipTrigger asChild>
                                             <span className="text-sm text-muted-foreground cursor-default flex items-center gap-1">
                                                 <Info className="h-4 w-4" />
                                                 (0 &lt; α ≤ 1)
                                             </span>
                                         </TooltipTrigger>
                                         <TooltipContent>
                                             <p>Enter a value between 0 (exclusive) and 1 (inclusive).</p>
                                         </TooltipContent>
                                     </Tooltip>
                                 </TooltipProvider>
                             </div>
                             {form.formState.errors.alpha && <p className="text-sm text-destructive">{form.formState.errors.alpha.message}</p>}
                         </div>

                         <div className="space-y-4">
                             <Label className="text-lg font-medium text-secondary-foreground">Categories (Groups)</Label>
                             {fields.length === 0 && (
                                <p className="text-sm text-muted-foreground p-3 border border-dashed rounded-md text-center">
                                    No categories added yet. Click "Add Category" to start.
                                </p>
                             )}
                             {fields.map((field, index) => (
                                 <div key={field.id} className="flex items-start gap-2 p-3 border rounded-md bg-card">
                                     <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.name`}>Name</Label>
                                             <Input
                                                 id={`groups.${index}.name`}
                                                 {...form.register(`groups.${index}.name`)}
                                                 className={cn("border", form.formState.errors.groups?.[index]?.name ? "border-destructive" : "border-input")}
                                                  onChange={(e) => {
                                                     form.setValue(`groups.${index}.name`, e.target.value, { shouldValidate: true });
                                                  }}
                                                  onBlur={() => form.trigger(`groups.${index}.name`)}
                                             />
                                             {form.formState.errors.groups?.[index]?.name && <p className="text-sm text-destructive">{form.formState.errors.groups?.[index]?.name?.message}</p>}
                                         </div>
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.experienced`}># Experienced Outcome</Label>
                                             <Input
                                                 id={`groups.${index}.experienced`}
                                                 type="number"
                                                 min="0"
                                                 step="1"
                                                  {...form.register(`groups.${index}.experienced`)}
                                                  className={cn("border", form.formState.errors.groups?.[index]?.experienced ? "border-destructive" : "border-input")}
                                                  onChange={(e) => {
                                                      form.setValue(`groups.${index}.experienced`, e.target.value === '' ? null : Number(e.target.value), { shouldValidate: true });
                                                  }}
                                                  onBlur={() => form.trigger(`groups.${index}.experienced`)}
                                             />
                                             {form.formState.errors.groups?.[index]?.experienced && <p className="text-sm text-destructive">{form.formState.errors.groups?.[index]?.experienced?.message}</p>}
                                         </div>
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.notExperienced`}># Did Not Experience</Label>
                                             <Input
                                                 id={`groups.${index}.notExperienced`}
                                                 type="number"
                                                 min="0"
                                                 step="1"
                                                  {...form.register(`groups.${index}.notExperienced`)}
                                                  className={cn("border", form.formState.errors.groups?.[index]?.notExperienced ? "border-destructive" : "border-input")}
                                                   onChange={(e) => {
                                                       form.setValue(`groups.${index}.notExperienced`, e.target.value === '' ? null : Number(e.target.value), { shouldValidate: true });
                                                   }}
                                                   onBlur={() => form.trigger(`groups.${index}.notExperienced`)}
                                             />
                                             {form.formState.errors.groups?.[index]?.notExperienced && <p className="text-sm text-destructive">{form.formState.errors.groups?.[index]?.notExperienced?.message}</p>}
                                         </div>
                                     </div>
                                     <Button
                                         type="button"
                                         variant="ghost"
                                         size="icon"
                                         onClick={() => {
                                             remove(index);
                                              setReportResults(null);
                                              setCalculationError(null);
                                          }}
                                          disabled={fields.length <= 0}
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
                                 onClick={() => {
                                      const existingNames = groupNames;
                                      let newName = `Group ${fields.length + 1}`;
                                      let suffix = 1;
                                      while (existingNames.includes(newName)) {
                                          newName = `Group ${fields.length + 1}-${suffix++}`;
                                      }
                                      append({ name: newName, experienced: 0, notExperienced: 0 });
                                  }}
                                 className="mt-2"
                             >
                                 <PlusCircle className="mr-2 h-4 w-4" /> Add Category
                             </Button>
                             {form.formState.errors.groups?.root && <p className="text-sm text-destructive mt-2">{form.formState.errors.groups.root.message}</p>}
                             {form.formState.errors.groups && typeof form.formState.errors.groups.message === 'string' && !form.formState.errors.groups.root && <p className="text-sm text-destructive mt-2">{form.formState.errors.groups.message}</p>}
                         </div>

                         {/* Removed Reference Category Selection Section */}

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

         <TabsContent value="report">
             <div ref={reportRef} className="bg-white p-4 rounded-md shadow">
                 <Card className="w-full max-w-7xl mx-auto shadow-lg mt-4 border-none">
                      <CardHeader className="flex flex-row justify-between items-center pb-2">
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

                     <CardContent className="space-y-6 pt-4">
                          {calculationError && (
                             <Alert variant={calculationError.toLowerCase().includes('warning') ? "default" : "destructive"} className={cn("w-full mb-4", calculationError.toLowerCase().includes('warning') ? "border-yellow-500/50 text-yellow-700 dark:border-yellow-600/60 dark:text-yellow-300 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400" : "")}>
                                 <AlertCircle className="h-4 w-4" />
                                 <AlertTitle>{calculationError.toLowerCase().includes('warning') ? "Warning" : "Error"}</AlertTitle>
                                 <AlertDescription>{calculationError}</AlertDescription>
                             </Alert>
                          )}

                        {reportResults && form.formState.isValid && (
                             <div className="space-y-2 p-4 border rounded-md bg-card mb-6">
                                <h3 className="text-md font-semibold text-secondary-foreground border-b pb-1 mb-2">Report Parameters</h3>
                                <div className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                     <div><strong>Significance Level (α):</strong> {formatDecimal(form.getValues('alpha'), 4)}</div>
                                     {/* <div><strong>Reference Categories:</strong> {selectedReferenceCategories.join(', ') || 'N/A'}</div> // Removed */}
                                </div>
                             </div>
                        )}

                          {reportResults?.contingencySummary && reportResults.contingencySummary.length > 0 && reportResults.totals && (
                             <div className="space-y-2">
                                 <h3 className="text-lg font-semibold text-secondary-foreground mb-2">Contingency Table Summary</h3>
                                 <div className="overflow-x-auto rounded-md border">
                                     <Table>
                                         <TableHeader className="table-header-dark">
                                             <TableRow>
                                                  <TableHead rowSpan={2} className="align-bottom pb-2">Category (Race)</TableHead>
                                                  <TableHead colSpan={3} className="text-center border-l border-r">Observed (Actual)</TableHead>
                                                  <TableHead rowSpan={2} className="text-center border-r align-bottom pb-2">% Experienced</TableHead>
                                                  <TableHead colSpan={2} className="text-center border-r">Expected</TableHead>
                                                  <TableHead rowSpan={2} className="text-center align-bottom pb-2">Chi-Sq Contribution</TableHead>
                                             </TableRow>
                                              <TableRow>
                                                   <TableHead className="text-right border-l"># Did NOT Experience</TableHead>
                                                   <TableHead className="text-right"># Experienced</TableHead>
                                                   <TableHead className="text-right border-r">Row Subtotal</TableHead>
                                                   <TableHead className="text-right border-r"># Did NOT Experience</TableHead>
                                                   <TableHead className="text-right"># Experienced</TableHead>
                                              </TableRow>
                                         </TableHeader>
                                         <TableBody>
                                             {reportResults.contingencySummary.map((row, index) => (
                                                 <TableRow key={row.name} className={cn("table-row-alt", "hover:bg-muted/50")}>
                                                      <TableCell className="font-medium py-2 px-4">{row.name}</TableCell>
                                                      <TableCell className="text-right py-2 px-4 table-cell-tint border-l">{row.notExperienced.toLocaleString()}</TableCell>
                                                      <TableCell className="text-right py-2 px-4 table-cell-tint">{row.experienced.toLocaleString()}</TableCell>
                                                      <TableCell className="text-right py-2 px-4 table-cell-tint border-r">{row.rowTotal.toLocaleString()}</TableCell>
                                                      <TableCell className="text-right py-2 px-4 table-cell-tint border-r">{formatPercent(row.percentExperienced)}</TableCell>
                                                      <TableCell className="text-right py-2 px-4 border-r">{formatDecimal(row.expectedNotExperienced, 1)}</TableCell>
                                                      <TableCell className="text-right py-2 px-4">{formatDecimal(row.expectedExperienced, 1)}</TableCell>
                                                      <TableCell className="text-right py-2 px-4">{formatDecimal(row.chiSquareContribution, 3)}</TableCell>
                                                 </TableRow>
                                             ))}
                                         </TableBody>
                                         <TableFooter>
                                               <TableRow className="bg-muted/80 font-semibold hover:bg-muted">
                                                    <TableCell className="py-2 px-4">Column Subtotal</TableCell>
                                                    <TableCell className="text-right py-2 px-4 border-l">{reportResults.totals.totalNotExperienced.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right py-2 px-4">{reportResults.totals.totalExperienced.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right py-2 px-4 border-r">{reportResults.totals.grandTotal.toLocaleString()}</TableCell>
                                                     <TableCell className="text-right py-2 px-4 border-r">
                                                        {reportResults.totals.grandTotal > 0 ? formatPercent((reportResults.totals.totalExperienced / reportResults.totals.grandTotal) * 100) : 'N/A'}
                                                     </TableCell>
                                                    <TableCell className="text-right py-2 px-4 border-r">{formatDecimal(reportResults.totals.totalExpectedNotExperienced, 1)}</TableCell>
                                                    <TableCell className="text-right py-2 px-4">{formatDecimal(reportResults.totals.totalExpectedExperienced, 1)}</TableCell>
                                                    <TableCell className="text-right py-2 px-4">{formatDecimal(reportResults.totals.totalChiSquareContributions, 3)}</TableCell>
                                               </TableRow>
                                          </TableFooter>
                                     </Table>
                                 </div>
                             </div>
                         )}

                         {reportResults?.overallStats && (
                             <div className="space-y-4 p-4 border rounded-md bg-card">
                                  <h3 className="text-lg font-semibold text-secondary-foreground border-b pb-2 mb-3">Overall Test Results</h3>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
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
                                      <div className="space-y-2">
                                           <div className="flex justify-between">
                                               <span className="font-medium"># of Pairwise Comparisons:</span>
                                               <span>{reportResults.overallStats.numComparisons}</span>
                                           </div>
                                           {reportResults.overallStats.numComparisons > 0 && (
                                                <div className="flex justify-between">
                                                    <span className="font-medium">Bonferroni Corrected α:</span>
                                                     <span>{formatScientific(reportResults.overallStats.limitAlpha / reportResults.overallStats.numComparisons, 3)}</span>
                                                </div>
                                           )}
                                           {reportResults.overallStats.numComparisons <= 0 && (
                                               <div className="flex justify-between">
                                                  <span className="font-medium">Bonferroni Corrected α:</span>
                                                  <span>N/A</span>
                                               </div>
                                           )}
                                      </div>

                                      <div className="col-span-1 sm:col-span-2 border-t pt-3 mt-2">
                                          <Table>
                                              <TableHeader className="border-b-0">
                                                  <TableRow className="border-b-0 hover:bg-transparent">
                                                      <TableHead className="font-medium pl-0 h-auto py-1">Test</TableHead>
                                                      <TableHead className="font-medium text-right h-auto py-1">Statistic</TableHead>
                                                      <TableHead className="font-medium text-right h-auto py-1">P-Value</TableHead>
                                                      <TableHead className="font-medium text-right pr-0 h-auto py-1 text-wrap max-w-[200px]">Interpretation (vs α)</TableHead>
                                                  </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                   <TableRow className="border-b-0 hover:bg-transparent">
                                                       <TableCell className="font-medium pl-0 py-1">Chi-square</TableCell>
                                                       <TableCell className="text-right py-1">{formatDecimal(reportResults.overallStats.chiSquare.statistic)}</TableCell>
                                                       <TableCell className={cn("text-right py-1", reportResults.overallStats.chiSquare.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                           {formatScientific(reportResults.overallStats.chiSquare.pValue)}
                                                       </TableCell>
                                                        <TableCell className="text-right pr-0 py-1">
                                                            {renderInterpretation(reportResults.overallStats.chiSquare.pValue, reportResults.overallStats.limitAlpha)}
                                                        </TableCell>
                                                   </TableRow>
                                                    <TableRow className="border-b-0 hover:bg-transparent">
                                                        <TableCell className="font-medium pl-0 py-1">Chi-square (Yates)</TableCell>
                                                        <TableCell className="text-right py-1">{formatDecimal(reportResults.overallStats.chiSquareYates.statistic)}</TableCell>
                                                        <TableCell className={cn("text-right py-1", reportResults.overallStats.chiSquareYates.pValue < reportResults.overallStats.limitAlpha ? 'text-destructive font-semibold' : '')}>
                                                           {formatScientific(reportResults.overallStats.chiSquareYates.pValue)}
                                                        </TableCell>
                                                         <TableCell className="text-right pr-0 py-1">
                                                              {renderInterpretation(reportResults.overallStats.chiSquareYates.pValue, reportResults.overallStats.limitAlpha)}
                                                          </TableCell>
                                                    </TableRow>
                                                    <TableRow className="border-b-0 hover:bg-transparent">
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

                           {reportResults?.pairwiseResultsMatrix && reportResults?.contingencySummary && reportResults.overallStats && reportResults.overallStats.numComparisons > 0 && reportResults.contingencySummary.length >= 2 && (
                                <div className="space-y-4">
                                    <h3 className="text-lg font-semibold text-secondary-foreground mb-2">
                                        P-Values of Pairwise Chi-Square Comparisons with Bonferroni Correction
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Corrected P-values shown below. The critical alpha for significance is α_bonf = {formatScientific(reportResults.overallStats.limitAlpha / reportResults.overallStats.numComparisons, 3)}.
                                        Significant p-values (&lt; α_bonf) are highlighted in <span className="text-destructive font-semibold">red</span>.
                                    </p>

                                    <div className="overflow-x-auto rounded-md border">
                                        <Table>
                                            <TableHeader className="table-header-dark">
                                                <TableRow>
                                                    <TableHead className="sticky left-0 bg-table-header-bg z-10">Category</TableHead>
                                                    {reportResults.contingencySummary.map(g => g.name).sort().map(name => (
                                                        <TableHead key={name} className="text-right">{name}</TableHead>
                                                    ))}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {reportResults.contingencySummary.map(g => g.name).sort().map((rowName) => (
                                                    <TableRow key={rowName} className="table-row-alt hover:bg-muted/50">
                                                        <TableCell className="font-medium sticky left-0 bg-background z-10">{rowName}</TableCell>
                                                        {reportResults.contingencySummary.map(g => g.name).sort().map((colName) => {
                                                            const pValue = reportResults.pairwiseResultsMatrix?.[rowName]?.[colName];
                                                            const correctedAlpha = (reportResults.overallStats?.limitAlpha ?? 0.05) / Math.max(1, reportResults.overallStats?.numComparisons ?? 1);
                                                            const isSignificant = typeof pValue === 'number' && !isNaN(pValue) && pValue < correctedAlpha;
                                                            const isDiagonal = rowName === colName;

                                                            return (
                                                                <TableCell
                                                                    key={`${rowName}-vs-${colName}`}
                                                                    className={cn(
                                                                        "text-right py-2 px-4",
                                                                        isSignificant ? 'text-destructive font-semibold' : 'text-muted-foreground',
                                                                        isDiagonal ? 'bg-muted/30' : 'table-cell-tint',
                                                                    )}
                                                                >
                                                                     {isDiagonal ? '-' : formatScientific(pValue, 3)}
                                                                </TableCell>
                                                            );
                                                        })}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                      <p className="text-xs text-muted-foreground italic mt-2">
                                        <span className="text-destructive font-semibold">Red bold text</span> indicates the pairwise difference is statistically significant (p &lt; α_bonf). Potential disparity between these two groups. Pursue further investigation.
                                      </p>
                                </div>
                           )}

                         {/* Removed Comparison to Reference Categories Section */}


                         {!reportResults && !calculationError && fields.length >= 2 && (
                             <p className="text-center text-muted-foreground italic">Generate a report to see the results here.</p>
                         )}
                         {!reportResults && !calculationError && fields.length < 2 && (
                             <p className="text-center text-muted-foreground italic">Add at least two categories and generate a report to see results.</p>
                         )}
                     </CardContent>
                 </Card>
             </div>
         </TabsContent>
     </Tabs>
 );
}

    