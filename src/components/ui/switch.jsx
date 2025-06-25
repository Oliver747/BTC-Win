import { useState, useEffect } from "react";

export function Switch({ checked, onCheckedChange }) {
  const [internalChecked, setInternalChecked] = useState(checked);

  useEffect(() => {
    setInternalChecked(checked);
  }, [checked]);

  const toggle = () => {
    const newValue = !internalChecked;
    setInternalChecked(newValue);
    if (onCheckedChange) onCheckedChange(newValue);
  };

  return (
    <div
      onClick={toggle}
      className={`w-10 h-5 flex items-center rounded-full cursor-pointer transition-colors duration-300 ${
        internalChecked ? "bg-green-400" : "bg-gray-300"
      }`}
    >
      <div
        className={`bg-white w-4 h-4 rounded-full shadow transform transition-transform duration-300 ${
          internalChecked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </div>
  );
}
