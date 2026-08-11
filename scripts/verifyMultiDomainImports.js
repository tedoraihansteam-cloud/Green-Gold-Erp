const fs = require('fs');
const path = require('path');
const { analyzeFile } = require('../src/services/universalImportService');

async function main() {
    const directory = process.argv[2];
    if (!directory || !fs.existsSync(directory)) throw new Error('Pass the directory containing the sample workbooks');
    const files = fs.readdirSync(directory).filter((name) => !name.startsWith('~$') && /\.(xlsx|xls|xlsm)$/i.test(name));
    let passed = 0;
    let failed = 0;
    for (const name of files) {
        try {
            const analysis = await analyzeFile({ path: path.join(directory, name), originalname: name }, 'auto');
            const sections = analysis.extractionResult?.sections || [];
            const types = [...new Set(sections.map((section) => section.type))];
            console.log(JSON.stringify({ status: 'PASS', name, detectedType: analysis.detectedDocumentType, sections: sections.length, records: analysis.sourceSummary?.records || analysis.previewRows?.length || 0, types }));
            passed++;
        } catch (error) {
            console.log(JSON.stringify({ status: 'FAIL', name, error: error.message }));
            failed++;
        }
    }
    console.log(JSON.stringify({ status: 'RESULT', passed, failed, total: files.length }));
    if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
