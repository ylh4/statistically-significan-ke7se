
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"; // Added TableFooter
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
    type ContributionDetail, // Import ContributionDetail type
    formatScientific,
    formatDecimal,
    formatPercent
} from "@/lib/calculations";
import { exportToCSV, type ExportFormValues } from '@/lib/utils'; // Corrected import type name
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
      let numValue = parseFloat(value);

       // Enforce range limits directly for better UX than just validation message
        if (!isNaN(numValue)) {
            if (numValue <= 0) numValue = 0.00000001; // Set to a very small positive number if <= 0
            if (numValue > 1) numValue = 1; // Cap at 1
            form.setValue('alpha', numValue, { shouldValidate: true });
        } else if (value === '') {
            // Allow temporary empty state, validation will catch it if submitted
            form.setValue('alpha', '' as any, { shouldValidate: true });
        } else {
            // If input is not a number (e.g., "abc"), keep it in input but mark as invalid
            form.setValue('alpha', value as any, { shouldValidate: true });
        }


      // Trigger calculation when alpha changes if results exist AND form is valid
      // Check validity specifically for alpha after setting it
       form.trigger('alpha').then(isValid => {
            if (isValid && reportResults) {
                // Use handleSubmit to ensure data is valid before recalculating
                form.handleSubmit(onSubmit)();
            } else if (!reportResults) {
                // Only clear errors if results don't exist yet
                setCalculationError(null);
            } else {
                // If alpha is now invalid, show validation message but don't clear results yet
                 setCalculationError(form.formState.errors.alpha?.message || null);
            }
       });
  };


   // Effect to update reference categories if group names change or groups are removed
  useEffect(() => {
    const currentReferences = form.getValues('referenceCategories') || [];
    const currentGroupNames = form.getValues('groups').map(g => g.name).filter(Boolean); // Get current names
    const validReferences = currentReferences.filter(ref => currentGroupNames.includes(ref));

    // Only update if the valid list differs from the current list
    if (JSON.stringify(validReferences) !== JSON.stringify(currentReferences)) {
         form.setValue('referenceCategories', validReferences, { shouldValidate: true });
    }

     // Auto-select the first group ONLY if no references are selected AND there's at least one group
     if (validReferences.length === 0 && currentGroupNames.length > 0) {
         form.setValue('referenceCategories', [currentGroupNames[0]], { shouldValidate: true });
     }


    // Clear results if groups change substantially (add/remove/rename)
    // We might want finer control, but this is safer for now.
    // setReportResults(null); // Keep results for minor edits
    // setCalculationError(null);

    // Trigger validation for referenceCategories when group names change
    form.trigger('referenceCategories');

  }, [groupNames, form]); // Depend on groupNames derived from watched fields


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
          if (currentGroupNames.length > 0) {
            form.setValue('referenceCategories', [currentGroupNames[0]], { shouldValidate: true });
          }
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
      // Use the calculation function
      const results = performMultiComparisonReport({
        alpha: data.alpha,
        groups: data.groups,
      });

      setReportResults(results); // Store the entire results object

        if (results.errors && results.errors.length > 0) {
             // Filter out warnings about expected counts < 5 for the main error state
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
                 setActiveTab("input"); // Stay on input tab on critical failure
             } else if (warningErrors.length > 0) {
                 const warningMsg = warningErrors.join('; ');
                 // Set a non-blocking error state for warnings
                  setCalculationError(`${warningMsg}`); // Display warnings without "Error:" prefix
                  toast({
                      title: "Calculation Warning",
                      description: warningMsg,
                      variant: "destructive", // Keep variant destructive for visibility
                      duration: 7000, // Shorter duration for warnings
                  });
                  setActiveTab("report"); // Still go to report tab for warnings
             } else {
                 // Should not happen if results.errors is not empty, but handle defensively
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
        setActiveTab("input"); // Stay on input tab on critical failure
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
              scrollX: 0, // Ensure capture starts from the left edge
              scrollY: 0, // Ensure capture starts from the top edge
              windowWidth: currentReportElement.scrollWidth, // Capture full width
              windowHeight: currentReportElement.scrollHeight, // Capture full height
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
 const currentAlpha = form.watch('alpha'); // Watch alpha for interpretations


 // Helper to render the interpretation text with icon
  const renderInterpretation = (
    p: number | null | undefined,
    alpha: number,
    isBonferroni: boolean = false // Flag for Bonferroni interpretation
  ) => {
    if (p === null || p === undefined || isNaN(p)) return <span className="text-xs italic text-muted-foreground">N/A</span>;

    const isSignificant = p < alpha;
    const interpretationText = isSignificant
        ? "Statistically different."
        : "Not statistically different.";

    // Standard follow-up, potentially adjust based on context if needed
    const followUpText = isSignificant
        ? " Potential disparity; pursue further investigation."
        : "";

    const fullText = interpretationText + followUpText;


    return (
         <span className={cn("ml-2 text-xs italic", isSignificant ? "text-destructive font-semibold" : "text-muted-foreground")}>
              {fullText}
              {/* Optional: Add icon or specific marker */}
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
                                     step="any" // Use 'any' for floating point
                                     min="0.00000001" // Smallest positive value (approx)
                                     max="1"
                                     // Use spread for register, but keep explicit onChange for clearing results
                                     {...form.register("alpha")}
                                     value={form.watch('alpha')} // Ensure input reflects form state including empty string and clamped values
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
                                                     setReportResults(null); // Clear results on name change
                                                     setCalculationError(null);
                                                     // useEffect handles reference updates/validation
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
                                                     // Only clear results if the form was previously submitted and valid
                                                     // This allows minor edits without losing the report unless explicitly regenerated
                                                     // setReportResults(null);
                                                     // setCalculationError(null);
                                                      // if (reportResults) form.handleSubmit(onSubmit)(); // Optional: Recalculate immediately
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
                                                      // setReportResults(null);
                                                      // setCalculationError(null);
                                                       // if (reportResults) form.handleSubmit(onSubmit)(); // Optional: Recalculate immediately
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
                                             setReportResults(null); // Clear results on remove
                                             setCalculationError(null);
                                             // useEffect handles reference updates
                                          }}
                                         // Only disable remove if 0 groups exist (let validation handle min 2)
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
                                      setReportResults(null); // Clear results on add
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
                                                         disabled={groupNames.length < 2} // Disable if less than 2 groups
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
                                                                  // Optionally trigger recalculation if results exist
                                                                   // if (reportResults) {
                                                                       // form.handleSubmit(onSubmit)();
                                                                   // } else {
                                                                       // setCalculationError(null);
                                                                   // }
                                                             }
                                                         }}
                                                     />
                                                     <Label
                                                         htmlFor={`ref-${name}`}
                                                         className={cn(
                                                             "font-normal cursor-pointer",
                                                             groupNames.length < 2 ? "text-muted-foreground cursor-not-allowed" : ""
                                                         )}
                                                     >
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
                         {/* Display calculation errors/warnings */}
                          {calculationError && (
                             <Alert variant={calculationError.toLowerCase().includes('warning') ? "default" : "destructive"} className={cn("w-full mb-4", calculationError.toLowerCase().includes('warning') ? "border-yellow-500/50 text-yellow-700 dark:border-yellow-600/60 dark:text-yellow-300 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400" : "")}>
                                 <AlertCircle className="h-4 w-4" />
                                 <AlertTitle>{calculationError.toLowerCase().includes('warning') ? "Warning" : "Error"}</AlertTitle>
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
                          {reportResults?.contingencySummary && reportResults.contingencySummary.length > 0 && reportResults.totals && (
                             <div className="space-y-2">
                                 <h3 className="text-lg font-semibold text-secondary-foreground mb-2">Contingency Table Summary</h3>
                                 <div className="overflow-x-auto rounded-md border">
                                     <Table>
                                         <TableHeader className="table-header-dark">
                                             <TableRow className="hover:bg-table-header-bg/90">
                                                  <TableHead rowSpan={2} className="align-bottom pb-2">Category (Race)</TableHead>
                                                  <TableHead colSpan={3} className="text-center border-l border-r">Observed (Actual)</TableHead>
                                                  <TableHead rowSpan={2} className="text-center border-r align-bottom pb-2">% Experienced</TableHead>
                                                  <TableHead colSpan={2} className="text-center border-r">Expected</TableHead>
                                                  <TableHead rowSpan={2} className="text-center align-bottom pb-2">Chi-Sq Contribution</TableHead>{/* Added Contribution Header */}
                                             </TableRow>
                                              <TableRow className="hover:bg-table-header-bg/90">
                                                   <TableHead className="text-right border-l"># Did NOT Experience</TableHead>
                                                   <TableHead className="text-right"># Experienced</TableHead>
                                                   <TableHead className="text-right border-r">Row Subtotal</TableHead>
                                                   <TableHead className="text-right border-r"># Did NOT Experience</TableHead> {/* Added Expected Not Exp Header */}
                                                   <TableHead className="text-right"># Experienced</TableHead> {/* Added Expected Exp Header */}
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
                                                      <TableCell className="text-right py-2 px-4 border-r">{formatDecimal(row.expectedNotExperienced, 1)}</TableCell> {/* Display Expected Not Exp */}
                                                      <TableCell className="text-right py-2 px-4">{formatDecimal(row.expectedExperienced, 1)}</TableCell> {/* Display Expected Exp */}
                                                      <TableCell className="text-right py-2 px-4">{formatDecimal(row.chiSquareContribution, 3)}</TableCell>{/* Display Contribution */}
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
                                                    <TableCell className="text-right py-2 px-4">{formatDecimal(reportResults.totals.totalChiSquareContributions, 3)}</TableCell> {/* Display Total Contribution */}
                                               </TableRow>
                                          </TableFooter>
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

                            {/* Phase 3: Pairwise Comparisons Matrix */}
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
                                                <TableRow className="hover:bg-table-header-bg/90">
                                                    <TableHead className="sticky left-0 bg-table-header z-10">Category</TableHead> {/* Sticky header */}
                                                    {reportResults.contingencySummary.map(g => g.name).sort().map(name => (
                                                        <TableHead key={name} className="text-right">{name}</TableHead>
                                                    ))}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {reportResults.contingencySummary.map(g => g.name).sort().map((rowName) => (
                                                    <TableRow key={rowName} className="table-row-alt hover:bg-muted/50">
                                                        <TableCell className="font-medium sticky left-0 bg-background z-10">{rowName}</TableCell> {/* Sticky cell */}
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
                                                                        isDiagonal ? 'bg-muted/30' : 'table-cell-tint', // Style diagonal differently
                                                                    )}
                                                                >
                                                                     {isDiagonal ? '-' : formatScientific(pValue, 3)} {/* Show dash for diagonal */}
                                                                    {/* Interpretation could be added via tooltip if needed */}
                                                                </TableCell>
                                                            );
                                                        })}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                     {/* Add interpretation notes based on significance */}
                                      <p className="text-xs text-muted-foreground italic mt-2">
                                        <span className="text-destructive font-semibold">Red bold text</span> indicates the pairwise difference is statistically significant (p &lt; α_bonf). Potential disparity between these two groups. Pursue further investigation.
                                      </p>
                                </div>
                           )}


                         {/* Section for Comparison to Reference Categories */}
                          {reportResults?.contingencySummary && reportResults.contingencySummary.length >= 2 && selectedReferenceCategories.length > 0 && reportResults.overallStats && reportResults.overallStats.numComparisons > 0 && (
                             <div className="space-y-4">
                                 <h3 className="text-lg font-semibold text-secondary-foreground mb-2">Comparison to Reference Categories</h3>
                                 {selectedReferenceCategories
                                      .filter(refName => reportResults.contingencySummary.some(g => g.name === refName)) // Filter out refs no longer in groups
                                      .map(referenceCategory => {
                                         const referenceGroup = reportResults.contingencySummary.find(g => g.name === referenceCategory);
                                         const otherGroups = reportResults.contingencySummary.filter(g => g.name !== referenceCategory);
                                         const correctedAlpha = (reportResults.overallStats?.limitAlpha ?? 0.05) / Math.max(1, reportResults.overallStats?.numComparisons ?? 1);

                                         if (!referenceGroup) return null; // Should not happen due to filter, but safe check

                                         return (
                                             <div key={referenceCategory} className="p-4 border rounded-md bg-card mb-4">
                                                 <h4 className="text-md font-semibold text-secondary-foreground border-b pb-1 mb-3">Reference: {referenceCategory}</h4>
                                                 <div className="overflow-x-auto">
                                                      <Table>
                                                          <TableHeader className="border-b-0">
                                                               <TableRow className="border-b-0 hover:bg-transparent">
                                                                   <TableHead className="pl-0 h-auto py-1">Comparison Group</TableHead>
                                                                   <TableHead className="text-right h-auto py-1">Corrected P-Value</TableHead>
                                                                   <TableHead className="text-right pr-0 h-auto py-1 text-wrap max-w-[200px]">Interpretation (vs α_bonf)</TableHead>
                                                               </TableRow>
                                                          </TableHeader>
                                                          <TableBody>
                                                               {otherGroups.length > 0 ? otherGroups
                                                                     .sort((a, b) => a.name.localeCompare(b.name)) // Sort comparison groups
                                                                     .map(comparisonGroup => {
                                                                          const pValue = reportResults.pairwiseResultsMatrix?.[referenceCategory]?.[comparisonGroup.name];
                                                                          const isSignificant = typeof pValue === 'number' && !isNaN(pValue) && pValue < correctedAlpha;

                                                                          return (
                                                                               <TableRow key={comparisonGroup.name} className="border-b-0 hover:bg-transparent">
                                                                                   <TableCell className="font-medium pl-0 py-1">{comparisonGroup.name}</TableCell>
                                                                                   <TableCell className={cn("text-right py-1", isSignificant ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                                                                                       {formatScientific(pValue, 3)}
                                                                                   </TableCell>
                                                                                    <TableCell className="text-right pr-0 py-1">
                                                                                        {renderInterpretation(pValue, correctedAlpha, true)} {/* Pass true for Bonferroni context */}
                                                                                    </TableCell>
                                                                               </TableRow>
                                                                          );
                                                               }) : (
                                                                    <TableRow className="border-b-0 hover:bg-transparent">
                                                                         <TableCell colSpan={3} className="text-center text-muted-foreground italic py-2">No other groups to compare.</TableCell>
                                                                    </TableRow>
                                                               )}
                                                          </TableBody>
                                                      </Table>
                                                 </div>
                                             </div>
                                         );
                                 })}
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
