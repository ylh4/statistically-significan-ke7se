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
import { Checkbox } from "@/components/ui/checkbox"; // Import Checkbox
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, PlusCircle, Download, RotateCcw, AlertCircle, FileDown, FileText, Info } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area"; // Import ScrollArea for checkbox list


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
} from "@/lib/calculations";
import { exportToCSV, type FormValues as ExportFormValues } from '@/lib/utils'; // Corrected import type name
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

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
    .lte(1, "Significance Level must be less than or equal to 1") // Allow 1
    .refine(val => val > 0, { message: "Significance Level must be greater than 0" }) // Separate check for > 0
    .default(0.05),
  groups: z.array(groupSchema).min(2, "At least two categories are required"),
  referenceCategories: z.array(z.string()).min(1, "At least one reference category must be selected"), // Add reference categories field
}).refine(data => {
    // Ensure selected reference categories still exist in the groups
    if (data.groups.length < 2 && data.referenceCategories.length > 0) {
        // Allow valid state if groups become less than 2 but refs were valid before
        return true;
    }
    const groupNames = data.groups.map(g => g.name);
    return data.referenceCategories.every(refCat => groupNames.includes(refCat));
  }, {
    message: "One or more selected reference categories no longer exist in the groups list.",
    path: ["referenceCategories"], // Path to show error
});


// Explicitly define FormValues based on the schema
type FormValues = z.infer<typeof formSchema>;


// --- Component ---
export default function DisparityCalculator() {
  const { toast } = useToast();
  const [reportResults, setReportResults] = useState<MultiComparisonResults | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<string>("input");

  // Start with empty default groups
  const defaultGroups: GroupInput[] = [];

   const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      alpha: 0.05,
      groups: defaultGroups,
      // Start with empty reference categories as well
      referenceCategories: [],
    },
     mode: "onChange", // Validate on change
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "groups",
  });

    // Watch group names to update checkbox options dynamically
  const groupFields = form.watch('groups');
  const groupNames = useMemo(() => groupFields.map(g => g.name).filter(name => name.trim() !== ''), [groupFields]);

  // Handler for Alpha input change
  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      // Allow empty input temporary, validation handles the rest
      if (value === '') {
         form.setValue('alpha', '' as any, { shouldValidate: true });
      } else {
          const numValue = parseFloat(value);
          // Only set if it's a potentially valid number, let zod handle range
          if (!isNaN(numValue)) {
              form.setValue('alpha', numValue, { shouldValidate: true });
          } else {
              // If input is not a number (e.g., "abc"), keep it in input but mark as invalid
              form.setValue('alpha', value as any, { shouldValidate: true });
          }
      }
      // Trigger calculation when alpha changes if results exist
      if (reportResults) {
         // Use handleSubmit to ensure data is valid before recalculating
         form.handleSubmit(onSubmit)();
      } else {
         // Only clear errors if results don't exist yet
         setCalculationError(null);
      }
  };

   // Effect to update reference categories if group names change or groups are removed
  useEffect(() => {
    const currentReferences = form.getValues('referenceCategories') || [];
    const validReferences = currentReferences.filter(ref => groupNames.includes(ref));

    // Only try to auto-select if there are groups available
    if (validReferences.length === 0 && groupNames.length > 0) {
        // If all selected references are gone OR none were selected yet, select the first available group
        form.setValue('referenceCategories', [groupNames[0]], { shouldValidate: true });
    } else if (validReferences.length !== currentReferences.length) {
         // If some (but not all) are gone, update the list to only valid ones
         form.setValue('referenceCategories', validReferences, { shouldValidate: true });
    }

    // Clear results if groups change substantially (add/remove/rename)
    // We might want finer control, but this is safer for now.
    setReportResults(null);
    setCalculationError(null);

    // Trigger validation for referenceCategories when group names change
    form.trigger('referenceCategories');

  }, [groupNames, form]);


  // Main calculation submission handler
  const onSubmit = (data: FormValues) => {
    setCalculationError(null);
    setReportResults(null); // Clear previous results

    // Ensure selected references are still valid (double-check)
     const currentGroupNames = data.groups.map(g => g.name);
     const validSelectedReferences = data.referenceCategories.filter(ref => currentGroupNames.includes(ref));

     // Check if selection is empty ONLY IF there are groups to select from
     if (currentGroupNames.length > 0 && validSelectedReferences.length === 0) {
          const errorMsg = "At least one reference category must be selected.";
          setCalculationError(errorMsg);
          toast({
              title: "Input Error",
              description: errorMsg,
              variant: "destructive",
          });
          setActiveTab("input"); // Stay on input tab
          // Attempt to select the first group if none are selected
           form.setValue('referenceCategories', [currentGroupNames[0]], { shouldValidate: true });
          return; // Stop submission
     }
     // Check if previously selected references are now invalid
     else if (validSelectedReferences.length !== data.referenceCategories.length) {
         const errorMsg = "One or more selected reference categories are no longer valid due to group changes. Please review your selection.";
         setCalculationError(errorMsg);
          toast({
                title: "Input Error",
                description: errorMsg,
                variant: "destructive",
           });
         setActiveTab("input"); // Stay on input tab
         // Update the form state to only the valid ones
         form.setValue('referenceCategories', validSelectedReferences, { shouldValidate: true });
         return; // Stop submission
     }


    try {
      // Use the calculation function (doesn't need referenceCategories directly)
      const results = performMultiComparisonReport({
        alpha: data.alpha,
        groups: data.groups,
      });

      setReportResults(results); // Store the entire results object

        if (results.errors && results.errors.length > 0) {
            const errorMsg = results.errors.join('; ');
             setCalculationError(`Calculation completed with warnings: ${errorMsg}`);
             toast({
                 title: "Calculation Warning",
                 description: errorMsg,
                 variant: "destructive",
                 duration: 10000,
             });
        } else {
            toast({
                title: "Calculation Successful",
                description: "Statistical report has been generated.",
            });
        }

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
    // Reset form to its default values including the default reference category
     form.reset({
        alpha: 0.05,
        groups: defaultGroups, // Reset to empty array
        referenceCategories: [], // Reset to empty array
     });
    setReportResults(null);
    setCalculationError(null);
     toast({
        title: "Form Reset",
        description: "All inputs and results have been cleared.",
     });
      setActiveTab("input");
  };

 // Handle CSV Export
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
       // Pass reportResults and the current form values (including reference selection)
       // Need to cast FormValues to ExportFormValues if they differ slightly, otherwise use directly
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

      // Ensure the report tab is active before capturing
      if (activeTab !== 'report') {
          setActiveTab('report');
          // Wait a short moment for the tab content to render
          await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Re-select the element after potential tab switch and re-render
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
        // Capture the specific report content area
        const canvas = await html2canvas(currentReportElement, {
             scale: 2, // Increase scale for better resolution
             useCORS: true, // If using external images/fonts
             logging: false, // Disable html2canvas logging in production
             backgroundColor: '#ffffff', // Set explicit background
        });

       const imgData = canvas.toDataURL('image/png');
       const pdf = new jsPDF({
           orientation: 'l', // landscape
           unit: 'pt', // points
           format: 'a4', // page format
           putOnlyUsedFonts:true,
           floatPrecision: 16 // or "smart", default is 16
       });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;

        // Calculate margins (e.g., 40 points)
        const margin = 40;
        const availableWidth = pdfWidth - margin * 2;
        const availableHeight = pdfHeight - margin * 2;

        // Calculate the ratio to fit the image within the available space
        const ratio = Math.min(availableWidth / imgWidth, availableHeight / imgHeight);

        // Calculate the dimensions and position of the image on the PDF
        const imgX = margin;
        const imgY = margin;
        const effectiveImgWidth = imgWidth * ratio;
        const effectiveImgHeight = imgHeight * ratio;


       // Add the image to the PDF, positioned with margins
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

 // Get selected reference categories from form state
 const selectedReferenceCategories = form.watch('referenceCategories') || [];

 // Helper to render the interpretation text with icon
 const renderInterpretation = (p: number | null | undefined, alpha: number) => {
    if (p === null || p === undefined || isNaN(p)) return null;
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
                 {/* Removed duplicate Toaster */}
                 <CardHeader>
                     <CardTitle className="text-2xl text-secondary-foreground">Input Parameters</CardTitle>
                 </CardHeader>
                 <CardContent>
                     <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                         {/* Alpha Input */}
                         <div className="space-y-2 max-w-xs">
                             <Label htmlFor="alpha">Significance Level (α)</Label>
                             <div className="flex items-center gap-2">
                                 <Input
                                     id="alpha"
                                     type="number"
                                     step="any"
                                     // Use spread for register, but keep explicit onChange for clearing results
                                     {...form.register("alpha")}
                                     value={form.watch('alpha')} // Ensure input reflects form state including empty string
                                     onChange={handleAlphaChange}
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

                         {/* Categories/Groups Section */}
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
                                         {/* Name */}
                                         <div className="space-y-1">
                                             <Label htmlFor={`groups.${index}.name`}>Name</Label>
                                             <Input
                                                 id={`groups.${index}.name`}
                                                 {...form.register(`groups.${index}.name`)}
                                                 className={cn("border", form.formState.errors.groups?.[index]?.name ? "border-destructive" : "border-input")}
                                                  onChange={(e) => {
                                                     // Update the specific field value
                                                     form.setValue(`groups.${index}.name`, e.target.value, { shouldValidate: true });
                                                     // Clear results and trigger reference validation
                                                     setReportResults(null);
                                                     setCalculationError(null);
                                                     // No need to trigger ref validation here, useEffect handles it
                                                  }}
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
                                                 className={cn("border", form.formState.errors.groups?.[index]?.experienced ? "border-destructive" : "border-input")}
                                                 onChange={(e) => {
                                                     form.setValue(`groups.${index}.experienced`, e.target.value as any, { shouldValidate: true });
                                                     setReportResults(null);
                                                     setCalculationError(null);
                                                 }}
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
                                                 className={cn("border", form.formState.errors.groups?.[index]?.notExperienced ? "border-destructive" : "border-input")}
                                                  onChange={(e) => {
                                                      form.setValue(`groups.${index}.notExperienced`, e.target.value as any, { shouldValidate: true });
                                                      setReportResults(null);
                                                      setCalculationError(null);
                                                  }}
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
                                             // useEffect handles reference updates
                                          }}
                                         // Only disable remove if 0 or 1 category exists (need 2 minimum for validation)
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
                                      // Auto-generate a unique name if possible
                                      const existingNames = groupNames;
                                      let newName = `Group ${fields.length + 1}`;
                                      let suffix = 1;
                                      while (existingNames.includes(newName)) {
                                          newName = `Group ${fields.length + 1}-${suffix++}`;
                                      }
                                      append({ name: newName, experienced: 0, notExperienced: 0 });
                                      setReportResults(null);
                                      setCalculationError(null);
                                      // useEffect will handle auto-selecting the first reference if needed
                                  }}
                                 className="mt-2"
                             >
                                 <PlusCircle className="mr-2 h-4 w-4" /> Add Category
                             </Button>
                             {/* Display root error for minimum number of groups */}
                             {form.formState.errors.groups?.root && <p className="text-sm text-destructive mt-2">{form.formState.errors.groups.root.message}</p>}
                             {/* Display general array error (e.g., from refine) */}
                             {form.formState.errors.groups && typeof form.formState.errors.groups.message === 'string' && !form.formState.errors.groups.root && <p className="text-sm text-destructive mt-2">{form.formState.errors.groups.message}</p>}
                         </div>


                         {/* Reference Category Selection */}
                         <div className="space-y-2">
                             <Label className="text-lg font-medium text-secondary-foreground">Select Reference Category(ies)</Label>
                              <ScrollArea className="h-40 w-full rounded-md border p-4"> {/* Added ScrollArea */}
                                 <Controller
                                     control={form.control}
                                     name="referenceCategories"
                                     render={({ field }) => (
                                         <div className="space-y-2">
                                             {groupNames.length > 0 ? groupNames.map((name) => (
                                                 <div key={name} className="flex items-center space-x-2">
                                                     <Checkbox
                                                         id={`ref-${name}`}
                                                         checked={field.value?.includes(name)}
                                                         onCheckedChange={(checked) => {
                                                             const currentValues = field.value || [];
                                                             let newValues;
                                                             if (checked) {
                                                                  newValues = [...currentValues, name];
                                                             } else {
                                                                  newValues = currentValues.filter(value => value !== name);
                                                             }
                                                             // Check if unchecking would leave none selected AND there are groups to select from
                                                             if (newValues.length === 0 && groupNames.length > 0 && !checked) {
                                                                toast({
                                                                    title: "Selection Required",
                                                                    description: "At least one reference category must be selected.",
                                                                    variant: "destructive",
                                                                    duration: 3000,
                                                                });
                                                                 // Don't update field.onChange if validation fails
                                                             } else {
                                                                  field.onChange(newValues);
                                                                  // Trigger calculation if results already exist
                                                                   if (reportResults) {
                                                                        form.handleSubmit(onSubmit)(); // Re-run calc
                                                                   } else {
                                                                       setCalculationError(null); // Clear error if no results yet
                                                                   }
                                                             }
                                                         }}
                                                     />
                                                     <Label htmlFor={`ref-${name}`} className="font-normal cursor-pointer">
                                                         {name}
                                                     </Label>
                                                 </div>
                                             )) : (
                                                 <p className="text-sm text-muted-foreground">Add at least two categories to select references.</p>
                                             )}
                                         </div>
                                     )}
                                 />
                               </ScrollArea>
                             {/* Display error specifically for referenceCategories */}
                             {form.formState.errors.referenceCategories && <p className="text-sm text-destructive mt-2">{form.formState.errors.referenceCategories.message}</p>}
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
             <div ref={reportRef} className="bg-white p-4 rounded-md shadow"> {/* This div will be captured for PDF */}
                 <Card className="w-full max-w-7xl mx-auto shadow-lg mt-4 border-none"> {/* Removed border */}
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
                         {calculationError && !reportResults && ( // Only show error if no results are displayed
                             <Alert variant="destructive" className="w-full mb-4">
                                 <AlertCircle className="h-4 w-4" />
                                 <AlertTitle>Error</AlertTitle>
                                 <AlertDescription>{calculationError}</AlertDescription>
                             </Alert>
                         )}
                         {calculationError && reportResults && ( // Show as warning if results exist but have issues
                              <Alert variant="destructive" className="w-full mb-4">
                                  <AlertCircle className="h-4 w-4" />
                                  <AlertTitle>Calculation Warning</AlertTitle>
                                  <AlertDescription>{calculationError}</AlertDescription>
                              </Alert>
                         )}


                        {/* Display Input Parameters in Report */}
                        {reportResults && form.formState.isValid && (
                             <div className="space-y-2 p-4 border rounded-md bg-card mb-6">
                                <h3 className="text-md font-semibold text-secondary-foreground border-b pb-1 mb-2">Report Parameters</h3>
                                <div className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                     <div><strong>Significance Level (α):</strong> {formatDecimal(form.getValues('alpha'), 4)}</div>
                                     <div><strong>Reference Categories:</strong> {selectedReferenceCategories.join(', ') || 'N/A'}</div>
                                </div>
                             </div>
                        )}


                         {/* Phase 1: Contingency Table Summary */}
                         {reportResults?.contingencySummary && reportResults.contingencySummary.length > 0 && (
                             <div className="space-y-2">
                                 <h3 className="text-lg font-semibold text-secondary-foreground mb-2">Contingency Table Summary</h3>
                                 <div className="overflow-x-auto rounded-md border">
                                     <Table>
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
                                                 <TableRow key={row.name} className={cn("table-row-alt", "hover:bg-muted/50")}>
                                                     <TableCell className="font-medium py-2 px-4">{row.name}</TableCell>
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
                                           {/* Display Bonferroni Alpha */}
                                           {reportResults.overallStats.numComparisons > 0 && (
                                                <div className="flex justify-between">
                                                    <span className="font-medium">Bonferroni Corrected α:</span>
                                                    <span>{formatDecimal(reportResults.overallStats.limitAlpha / reportResults.overallStats.numComparisons, 4)}</span>
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
                                              <TableHeader>
                                                  <TableRow className="border-b-0">
                                                      <TableHead className="pl-0">Test</TableHead>
                                                      <TableHead className="text-right">Statistic</TableHead>
                                                      <TableHead className="text-right">P-Value</TableHead>
                                                      <TableHead className="text-right pr-0">Interpretation (vs α)</TableHead>{/* Clarified interpretation context */}
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

                           {/* Phase 3: Pairwise Comparisons (Filtered by Selected References) */}
                           {reportResults?.pairwiseResultsMatrix && reportResults?.contingencySummary && reportResults.overallStats && reportResults.overallStats.numComparisons > 0 && selectedReferenceCategories.length > 0 && (
                               <div className="space-y-4">
                                   <h3 className="text-lg font-semibold text-secondary-foreground mb-2">
                                       Pairwise Chi-Square Comparisons with Bonferroni Correction
                                   </h3>
                                   <p className="text-xs text-muted-foreground">
                                       Displaying comparisons against selected reference category(ies).
                                       P-values corrected using Bonferroni method (critical α = {formatDecimal(reportResults.overallStats.limitAlpha / reportResults.overallStats.numComparisons, 4)}).
                                       Significant p-values (less than critical α) are highlighted in <span className="text-destructive font-semibold">red</span>.
                                   </p>

                                   {/* Iterate through selected reference categories only */}
                                   {selectedReferenceCategories
                                        .filter(refName => reportResults.contingencySummary.some(g => g.name === refName)) // Ensure ref exists
                                        .sort() // Optional: sort reference groups alphabetically
                                        .map((referenceName) => (
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
                                                           <TableHead className="text-right pr-0">Interpretation (vs Bonf. α)</TableHead>{/* Clarified interpretation */}
                                                       </TableRow>
                                                   </TableHeader>
                                                   <TableBody>
                                                       {/* Get all group names for comparison */}
                                                       {reportResults.contingencySummary
                                                            .map(g => g.name)
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
                                                                            isSignificant ? 'text-destructive font-semibold' : 'text-muted-foreground' // Use muted for non-significant
                                                                        )}>
                                                                            {formatScientific(pValue)}
                                                                        </TableCell>
                                                                        <TableCell className="text-right pr-0 py-1">
                                                                             {/* Use correctedAlpha for pairwise interpretation */}
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


                         {!reportResults && !calculationError && fields.length >= 2 && ( // Show only if enough categories exist
                             <p className="text-center text-muted-foreground italic">Generate a report to see the results here.</p>
                         )}
                         {!reportResults && !calculationError && fields.length < 2 && ( // Message when not enough categories
                             <p className="text-center text-muted-foreground italic">Add at least two categories and generate a report to see results.</p>
                         )}
                     </CardContent>
                 </Card>
             </div>
         </TabsContent>
     </Tabs>
 );
}
