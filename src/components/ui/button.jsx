export function Button({ children, onClick, variant = "default" }) {
  const base = "rounded px-4 py-2 font-semibold";
  const styles = {
    default: "bg-blue-600 text-white hover:bg-blue-700",
    outline: "border border-blue-600 text-blue-600 hover:bg-blue-100",
  };
  return (
    <button className={`${base} ${styles[variant]}`} onClick={onClick}>
      {children}
    </button>
  );
}
