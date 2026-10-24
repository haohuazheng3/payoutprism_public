import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("tiktok-shop");

export default function Page() {
  return (
    <CalculatorPage slug="tiktok-shop">
      <Ui />
    </CalculatorPage>
  );
}
