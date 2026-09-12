'use client';

import dynamic from 'next/dynamic';

const SpeedometerGauge = dynamic(() => import('@/components/SpeedometerGauge'), {
  ssr: false,
  loading: () => (
    <div className="w-[340px] h-[340px] sm:w-[460px] sm:h-[460px] md:w-[540px] md:h-[540px] rounded-full bg-[#0d1210] border-4 border-[#1f2823] animate-pulse" />
  ),
});

export default function Page() {
  return (
    <main
      id="speedometer-demo-page"
      className="w-screen h-screen flex items-center justify-center bg-[#070908] overflow-hidden p-4"
    >
      <SpeedometerGauge />
    </main>
  );
}
