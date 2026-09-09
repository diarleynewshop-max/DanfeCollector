'use client';

export default function BotaoImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
    >
      Ctrl+P / Salvar em PDF
    </button>
  );
}
