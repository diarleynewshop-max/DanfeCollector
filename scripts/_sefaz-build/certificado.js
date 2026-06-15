"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.carregarCertificado = carregarCertificado;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Carrega o certificado A1 (.pfx) configurado no .env.
 * O arquivo NUNCA deve ser commitado (pasta certs/ está no .gitignore).
 */
function carregarCertificado() {
    const pfxPath = process.env.CERT_PFX_PATH;
    const passphrase = process.env.CERT_PFX_PASSWORD;
    if (!pfxPath || !passphrase) {
        throw new Error('Certificado não configurado. Defina CERT_PFX_PATH e CERT_PFX_PASSWORD no .env ' +
            '(coloque o arquivo .pfx original do certificado A1 na pasta certs/).');
    }
    const caminhoAbsoluto = path.isAbsolute(pfxPath)
        ? pfxPath
        : path.resolve(process.cwd(), pfxPath);
    if (!fs.existsSync(caminhoAbsoluto)) {
        throw new Error(`Arquivo do certificado não encontrado: ${caminhoAbsoluto}`);
    }
    return { pfx: fs.readFileSync(caminhoAbsoluto), passphrase };
}
