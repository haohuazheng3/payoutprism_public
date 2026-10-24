import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("gumroad");

export default function Page() {
  return (
    <CalculatorPage slug="gumroad">
      <Ui />
    </CalculatorPage>
  );
}
