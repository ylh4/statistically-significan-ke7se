"use client";

import type { ChangeEvent, FormEvent } from 'react';
import React, { useState, useEffect, useMemo } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, PlusCircle, Download, RotateCcw, AlertCircle, CheckCircle, XCircle, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { calculateDisparity, type CalculationResult, type Category, invNormCDF } from "@/lib/calculations"; // Import invNormCDF
import { exportToCSV } from '@/lib/utils';
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";


// --- Zod Schema Definition ---
const categorySchema = z.object({
  name: z.string().min(1, "Category name cannot be empty"),
  count: z.coerce // Use coerce to convert input string to number
    .number({ invalid_type_error: "Count must be a number" })
    .int("Count must be an integer")
    .nonnegative("Count cannot be negative"),
});

const formSchema = z.object({
  N: z.coerce
    .number({ invalid_type_error: "Total Sample Size must be a number" })
    .int("Total Sample Size must be an integer")
    .positive("Total Sample Size must be positive")
    .min(30, "Total Sample Size (N) must be at least 30"),
  alpha: z.coerce
    .number({ invalid_type_error: "Significance Level must be a number" })
    .positive("Significance Level must be positive") // Must be > 0
    .lt(1, "Significance Level must be less than 1") // Must be < 1
    .refine(val => val >= 0.0001, { message: "Significance Level must be at least 0.0001" }) // Practical lower bound
    .refine(val => val <= 0.9999, { message: "Significance Level must be at most 0.9999" }), // Practical upper bound - Added 'val' argument
  categories: z.array(categorySchema).min(2, "At least two categories are required"),
  referenceCategoryName: z.string().min(1, "Please select a reference category"),
}).refine(data => {
    // Ensure N is a valid number before proceeding
    if (isNaN(data.N)) return false;
    const totalCount = data.categories.reduce((sum, cat) => sum + (isNaN(cat.count) ? 0 : cat.count), 0);
    return totalCount === data.N;
}, {
    message: "Sum of category counts must equal Total Sample Size (N)",
    path: ["categories"], // Attach error to the categories field array level or a general path
});

type FormValues = z.infer<typeof formSchema>;


// --- Component ---
export default function DisparityCalculator() {
  const { toast } = useToast();
  const [results, setResults] = useState<CalculationResult[]>([]);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [referenceProportion, setReferenceProportion] = useState<number | null>(null);


   const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      N: 100, // Sensible default
      alpha: 0.05,
      categories: [
        { name: "Group A", count: 50 },
        { name: "Group B", count: 50 },
      ],
      referenceCategoryName: "",
    },
     mode: "onChange", // Validate on change for inline feedback
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "categories",
  });

  const watchCategories = form.watch("categories");
  const watchN = form.watch("N");
  const watchReference = form.watch("referenceCategoryName");
  const watchAlpha = form.watch("alpha"); // Watch alpha

   // Update reference category options when categories change
  const categoryOptions = useMemo(() => {
    return watchCategories.map((cat) => cat.name).filter(name => name?.trim());
  }, [watchCategories]);

  // Reset reference category if it's removed or name changes drastically
  useEffect(() => {
    if (watchReference && !categoryOptions.includes(watchReference)) {
      form.setValue("referenceCategoryName", "");
    }
     // Auto-select first category as reference if only two exist and none selected
    if (fields.length === 2 && !watchReference && categoryOptions.length === 2) {
         form.setValue("referenceCategoryName", categoryOptions[0]);
    }
  }, [categoryOptions, watchReference, form, fields.length]);

   // Update reference proportion when N, reference category, or counts change
  useEffect(() => {
    const nValue = typeof watchN === 'number' && !isNaN(watchN) ? watchN : 0;
    const refCat = watchCategories.find(cat => cat.name === watchReference);
    if (refCat && nValue > 0 && !isNaN(refCat.count)) {
      setReferenceProportion(refCat.count / nValue);
    } else {
      setReferenceProportion(null);
    }
  }, [watchN, watchReference, watchCategories]);


  // Recalculate total count for validation feedback
   const currentTotalCount = useMemo(() => {
     // Ensure counts are treated as numbers, default to 0 if invalid
     return watchCategories.reduce((sum, cat) => sum + (isNaN(cat.count) ? 0 : Number(cat.count)), 0);
   }, [watchCategories]);

   // Check if N is a valid number before comparing
   const nValue = typeof watchN === 'number' && !isNaN(watchN) ? watchN : 0;
   const countMatchesN = nValue > 0 && currentTotalCount === nValue;

  // Calculate critical Z value based on alpha for display
  const criticalZ = useMemo(() => {
    if (typeof watchAlpha === 'number' && !isNaN(watchAlpha) && watchAlpha > 0 && watchAlpha < 1) {
      const z = invNormCDF(1 - watchAlpha / 2);
      return isNaN(z) ? 'N/A' : z.toFixed(4);
    }
    return 'N/A';
  }, [watchAlpha]);


  const onSubmit = (data: FormValues) => {
    setCalculationError(null);
    setResults([]); // Clear previous results
    setReferenceProportion(null); // Clear old reference proportion
    try {
      const calculatedResults = calculateDisparity({
        N: data.N,
        alpha: data.alpha,
        categories: data.categories,
        referenceCategoryName: data.referenceCategoryName,
      });
      setResults(calculatedResults);

      // Update reference proportion based on final submitted data
      const refCatData = data.categories.find(c => c.name === data.referenceCategoryName);
      if (refCatData && data.N > 0) {
        setReferenceProportion(refCatData.count / data.N);
      }


       toast({
            title: "Calculation Successful",
            description: "Disparity results have been generated.",
       });

      // Check for individual calculation errors within results
       const errorsInResults = calculatedResults.filter(r => r.error);
        if (errorsInResults.length > 0) {
             setCalculationError(`Errors occurred during calculation for: ${errorsInResults.map(r => r.categoryName).join(', ')}. See table for details.`);
             toast({
                title: "Calculation Warning",
                description: "Some categories could not be calculated. See table.",
                variant: "destructive",
             });
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
    }
  };

  const handleReset = () => {
    // Reset form to default values, not just empty
    form.reset({
       N: 100,
       alpha: 0.05,
       categories: [
         { name: "Group A", count: 50 },
         { name: "Group B", count: 50 },
       ],
       referenceCategoryName: "",
    });
    setResults([]);
    setCalculationError(null);
    setReferenceProportion(null);
     toast({
        title: "Form Reset",
        description: "All inputs and results have been cleared.",
     });
  };

  const handleExport = () => {
      if (results.length === 0) {
           toast({
                title: "Export Failed",
                description: "No results to export.",
                variant: "destructive",
           });
          return;
      }
    try {
        // Pass the reference category name for inclusion in the CSV
        exportToCSV(results, `disparity-results_${form.getValues('referenceCategoryName')}.csv`, form.getValues('referenceCategoryName'));
         toast({
            title: "Export Successful",
            description: "Results exported to CSV.",
         });
    } catch (error) {
        console.error("CSV Export failed:", error);
         toast({
            title: "Export Failed",
            description: "Could not export results to CSV.",
            variant: "destructive",
         });
    }
  };

  // Format numbers, handling NaN and Infinity
  const formatNumber = (num: number | undefined | null, decimals: number = 4): string => {
      if (num === undefined || num === null || isNaN(num)) {
          return 'N/A';
      }
       if (num === Infinity) return 'Infinity';
       if (num === -Infinity) return '-Infinity';
      return num.toFixed(decimals);
  };



  return (
    <Card className="w-full max-w-5xl mx-auto shadow-lg"> {/* Increased max-width */}
       <Toaster />
      <CardHeader>
        <CardTitle className="text-2xl text-secondary-foreground">Input Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* N and Alpha Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-2">
              <Label htmlFor="N">Total Sample Size (N)</Label>
              <Input
                id="N"
                type="number"
                min="30" // Keep browser min for usability, Zod enforces >= 30
                step="1"
                {...form.register("N")}
                className={cn(form.formState.errors.N ? "border-destructive" : "")}
              />
              {form.formState.errors.N && <p className="text-sm text-destructive">{form.formState.errors.N.message}</p>}
            </div>
             <div className="space-y-2">
              <Label htmlFor="alpha">Significance Level (α)</Label>
               <Controller
                  control={form.control}
                  name="alpha"
                  render={({ field: { onChange, onBlur, value, ref } }) => (
                     <Input
                       id="alpha"
                       type="number"
                       step="0.001"
                       min="0.0001"
                       max="0.9999"
                       value={value ?? ''} // Ensure value is not undefined/null for input
                       onChange={(e) => {
                          const numVal = e.target.value === '' ? null : parseFloat(e.target.value);
                          onChange(numVal); // Pass null or number to react-hook-form
                       }}
                       onBlur={onBlur}
                       ref={ref}
                       className={cn(form.formState.errors.alpha ? "border-destructive" : "")}
                     />
                  )}
               />
               {form.formState.errors.alpha && <p className="text-sm text-destructive">{form.formState.errors.alpha.message}</p>}
            </div>
          </div>

          {/* Categories Section */}
          <div className="space-y-4">
            <Label className="text-lg font-medium text-secondary-foreground">Categories</Label>
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2 p-3 border rounded-md bg-card">
                <div className="flex-1 grid grid-cols-2 gap-2">
                     <div className="space-y-1">
                       <Label htmlFor={`categories.${index}.name`}>Name</Label>
                        <Input
                        id={`categories.${index}.name`}
                        {...form.register(`categories.${index}.name`)}
                         className={cn(form.formState.errors.categories?.[index]?.name ? "border-destructive" : "")}
                        />
                         {form.formState.errors.categories?.[index]?.name && <p className="text-sm text-destructive">{form.formState.errors.categories?.[index]?.name?.message}</p>}
                     </div>
                     <div className="space-y-1">
                        <Label htmlFor={`categories.${index}.count`}>Count</Label>
                        <Input
                        id={`categories.${index}.count`}
                        type="number"
                        min="0" // Keep non-negative constraint
                        step="1"
                        {...form.register(`categories.${index}.count`)}
                        className={cn(form.formState.errors.categories?.[index]?.count ? "border-destructive" : "")}
                        />
                        {form.formState.errors.categories?.[index]?.count && <p className="text-sm text-destructive">{form.formState.errors.categories?.[index]?.count?.message}</p>}
                     </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
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
              onClick={() => append({ name: `Group ${String.fromCharCode(65 + fields.length)}`, count: 0 })}
              className="mt-2"
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Add Category
            </Button>

             {/* Validation message for sum of counts */}
              {!countMatchesN && watchCategories.length > 0 && nValue > 0 && (
                 <p className="text-sm text-destructive">
                    Sum of counts ({currentTotalCount}) does not match Total Sample Size ({nValue || 'N/A'}).
                 </p>
              )}
              {/* Display root level error if refine fails */}
             {form.formState.errors.categories?.root && <p className="text-sm text-destructive">{form.formState.errors.categories.root.message}</p>}
             {/* Display general message if not attached to root */}
             {form.formState.errors.categories && typeof form.formState.errors.categories.message === 'string' && !form.formState.errors.categories.root && <p className="text-sm text-destructive">{form.formState.errors.categories.message}</p>}


          </div>

            {/* Reference Category Selection */}
            <div className="space-y-2">
                <Label htmlFor="referenceCategoryName">Reference Category</Label>
                 <Controller
                    control={form.control}
                    name="referenceCategoryName"
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value} >
                            <SelectTrigger id="referenceCategoryName" className={cn(form.formState.errors.referenceCategoryName ? "border-destructive" : "")}>
                                <SelectValue placeholder="Select reference category" />
                            </SelectTrigger>
                            <SelectContent>
                                {categoryOptions.map(name => (
                                <SelectItem key={name} value={name} disabled={name.trim() === ''}>
                                    {name || '(Empty Name)'}
                                </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                     )}
                    />
                 {form.formState.errors.referenceCategoryName && <p className="text-sm text-destructive">{form.formState.errors.referenceCategoryName.message}</p>}
            </div>


          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-4 pt-4">
             <Button type="button" variant="outline" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reset Form
            </Button>
            <Button type="submit" disabled={!form.formState.isValid} className="bg-primary hover:bg-accent text-primary-foreground">
              Calculate Disparity
            </Button>
          </div>
        </form>
      </CardContent>

      {/* Results Section */}
      {(results.length > 0 || calculationError) && (
        <CardFooter className="flex-col items-start gap-4 pt-6 border-t">
           <div className="flex justify-between w-full items-center mb-4">
             <div className='flex flex-col sm:flex-row sm:items-center gap-x-4'>
                 <h2 className="text-xl font-semibold text-secondary-foreground">Results</h2>
                 <span className="text-sm text-muted-foreground">
                    (Reference: {watchReference || 'N/A'} {referenceProportion !== null ? `[p = ${formatNumber(referenceProportion)}]` : ''}, α = {formatNumber(watchAlpha)}, Critical Z = ±{criticalZ})
                 </span>
             </div>
              <Button
                    type="button"
                    variant="outline"
                    onClick={handleExport}
                    disabled={results.length === 0}
                    className="ml-auto"
                >
                    <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
           </div>

          {calculationError && (
            <Alert variant="destructive" className="w-full mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Calculation Error</AlertTitle>
              <AlertDescription>{calculationError}</AlertDescription>
            </Alert>
          )}

          {results.length > 0 && (
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader className="bg-secondary">
                  <TableRow>
                    <TableHead>Comparison Group</TableHead> {/* Changed Header */}
                    <TableHead className="text-right">Proportion (p)</TableHead> {/* Simplified Header */}
                    <TableHead className="text-right">Difference (δ)</TableHead>
                    <TableHead className="text-right">Std. Error (SE)</TableHead>
                    <TableHead className="text-right">Z-Statistic</TableHead>
                    <TableHead className="text-right">Confidence Interval (CI)</TableHead> {/* Combined CI */}
                    <TableHead className="text-center">Statistically Significant?</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {/* Reference Category Row - REMOVED */}

                  {/* Display Comparison Category Rows */}
                  {results.map((result) => (
                    <TableRow
                      key={result.categoryName}
                       className={cn(
                          result.error && "bg-destructive/10", // Light red background ONLY for error rows
                           !result.error && result.isSignificant && "bg-muted/40", // Neutral muted background for significant rows
                           !result.error && !result.isSignificant && "hover:bg-muted/50" // Standard hover for non-significant non-error rows
                       )}
                    >
                      <TableCell className="font-medium">{result.categoryName}</TableCell>
                      <TableCell className="text-right">{formatNumber(result.pi)}</TableCell>
                      <TableCell className={cn("text-right",
                         result.isSignificant && "font-semibold", // Bold significant differences
                         result.isSignificant && result.delta > 0 && "text-destructive", // Red for positive significant diff
                         result.isSignificant && result.delta < 0 && "text-significant-blue" // Blue for negative significant diff
                       )}>
                         {formatNumber(result.delta)}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(result.SE)}</TableCell>
                      <TableCell className={cn("text-right",
                         result.isSignificant && "font-semibold" // Bold significant Z-stats
                       )}>
                        {formatNumber(result.zStat)}
                      </TableCell>
                      <TableCell className="text-right">
                           {/* Combined CI */}
                            {result.error ? 'N/A' : `[${formatNumber(result.ciLow)}, ${formatNumber(result.ciHigh)}]`}
                      </TableCell>
                       <TableCell className="text-center">
                          {result.error ? (
                              <span className="text-destructive font-medium flex items-center justify-center">
                                 <XCircle className="mr-1 h-4 w-4" /> Error
                              </span>
                          ) : result.isSignificant ? (
                               <span className={cn("font-medium flex items-center justify-center",
                                  result.delta > 0 ? "text-destructive" : "text-significant-blue"
                               )}>
                                  {result.delta > 0
                                     ? <ArrowUpCircle className="mr-1 h-4 w-4" />
                                     : <ArrowDownCircle className="mr-1 h-4 w-4" />
                                  }
                                  Yes
                               </span>
                          ) : (
                             <span className="text-muted-foreground flex items-center justify-center">
                               <CheckCircle className="mr-1 h-4 w-4 text-green-600" /> No
                             </span>
                          )}
                       </TableCell>
                      <TableCell className="text-xs text-destructive"> {/* Ensure error text is visible */}
                        {result.error ? result.error : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
