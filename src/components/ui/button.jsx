export function Button({ children, onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow ${className || ""}`}
    >
      {children}
    </button>
  );
}
