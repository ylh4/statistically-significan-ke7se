
import DisparityCalculator from '@/components/disparity-calculator';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';


export default function Home() {
  return (
    <main className="container mx-auto p-4 md:p-8">
       <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-primary flex-1 text-center">
              Statistically Significant: Disparity Calculator
            </h1>
             <Link href="/readme" className="ml-4">
                 <Button variant="outline" size="sm">
                     <Info className="mr-2 h-4 w-4" /> About
                 </Button>
             </Link>
       </div>

      <DisparityCalculator />
    </main>
  );
}
