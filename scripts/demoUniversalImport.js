const fs = require('fs');
const path = require('path');
const { analyzeFile } = require('../src/services/universalImportService');

async function main() {
    const target = process.argv[2];
    if (!target) throw new Error('Usage: node scripts/demoUniversalImport.js <file-or-folder>');
    const absolute = path.resolve(target);
    const files = fs.statSync(absolute).isDirectory()
        ? fs.readdirSync(absolute).filter((name) => !name.startsWith('~$')).map((name) => path.join(absolute, name)).filter((name) => /\.(xlsx|xls|xlsm|docx|csv|json)$/i.test(name))
        : [absolute];
    const results = [];
    for (const filePath of files) {
        try {
            const result = await analyzeFile({ path: filePath, originalname: path.basename(filePath) }, 'auto');
            results.push({
                file: path.basename(filePath), detectedType: result.detectedDocumentType,
                sheets: result.sourceSummary?.sheets || result.sourceSummary?.detectedSheets || 1,
                sections: result.sourceSummary?.sections || 1,
                records: result.sourceSummary?.records || result.sourceSummary?.goodsReceipts || result.previewRows?.length || 0,
                entities: result.sourceSummary?.entityCandidates || 0,
                duplicates: result.sourceSummary?.duplicates || 0,
                sectionTypes: result.sourceSummary?.sectionTypes || {}
            });
        } catch (error) {
            results.push({ file: path.basename(filePath), error: error.message });
        }
    }
    const successful = results.filter((item) => !item.error);
    const report = {
        safety: 'Read-only extraction demo. No database connection, ERP posting, Git commit, or Git push is performed.',
        filesAnalyzed: files.length, successful: successful.length, failed: results.length - successful.length,
        totals: {
            sheets: successful.reduce((sum, item) => sum + Number(item.sheets || 0), 0),
            sections: successful.reduce((sum, item) => sum + Number(item.sections || 0), 0),
            records: successful.reduce((sum, item) => sum + Number(item.records || 0), 0),
            entities: successful.reduce((sum, item) => sum + Number(item.entities || 0), 0)
        },
        results
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
