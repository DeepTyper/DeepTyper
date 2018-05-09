"use strict";
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
function print(x) { console.log(x); }
var removableLexicalKinds = [
    ts.SyntaxKind.EndOfFileToken,
    ts.SyntaxKind.NewLineTrivia,
    ts.SyntaxKind.WhitespaceTrivia
];
var templateKinds = [
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateSpan,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.TemplateExpression,
    ts.SyntaxKind.TaggedTemplateExpression,
    ts.SyntaxKind.FirstTemplateToken,
    ts.SyntaxKind.LastTemplateToken,
    ts.SyntaxKind.TemplateMiddle
];
try {
    fs.mkdirSync(outputDirGold);
    fs.mkdirSync(outputDirAll);
    fs.mkdirSync(outputDirCheckJS);
}
catch (err) {
}
let root = "data/Repos-cleaned";
let outputDirGold = "data/outputs-gold/";
let outputDirAll = "data/outputs-all/";
let outputDirCheckJS = "data/outputs-checkjs/";
try {
    fs.mkdirSync(outputDirGold);
    fs.mkdirSync(outputDirAll);
    fs.mkdirSync(outputDirCheckJS);
}
catch (err) {
}
const ANY_THRESHOLD = 0.2;
fs.readdirSync(root).forEach(org => fs.readdirSync(root + "/" + org).forEach(project => traverseProject(org, project)));
function traverseProject(org, project) {
	// This project stalls forever
	if (org == "SAP") return
    let dir = root + "/" + org + "/" + project;
    let outFile = dir.substr(root.length + 1) + ".json";
    outFile = outFile.replace(/\//g, "__");
	let outFileGold = outputDirGold + outFile;
    let outFileAll = outputDirAll + outFile;
    let outFileCheckJS = outputDirCheckJS + outFile;
	if (fs.existsSync(outFileGold)) return
	let projectTokens = traverse(dir);
    fs.writeFileSync(outFileGold, projectTokens[0].join("\n"), 'utf-8');
    fs.writeFileSync(outFileAll, projectTokens[1].join("\n"), 'utf-8');
    fs.writeFileSync(outFileCheckJS, projectTokens[2].join("\n"), 'utf-8');
}
function traverse(dir) {
    var children = fs.readdirSync(dir);
    let projectTokens = [[], [], []];
    if (children.find(value => value == "tsconfig.json")) {
        print("Config in: " + dir);
		// We extract two aligned sequences: the 'true' ones from the initial pass and the tsc+CheckJS derived ones from this pass (without true annotations)
		let fileContents = extractAlignedSequences(dir);
		if (fileContents != null) {
			projectTokens[0] = projectTokens[0].concat(fileContents[0]);
			projectTokens[1] = projectTokens[1].concat(fileContents[1]);
			projectTokens[2] = projectTokens[2].concat(fileContents[2]);
		}
    }
    else {
        children.forEach(function (file) {
            let fullPath = dir + "/" + file;
			try {
				if (fs.statSync(fullPath).isDirectory()) {
					fullPath.indexOf("DefinitelyTyped")
					if (fullPath.indexOf("DefinitelyTyped") < 0 && fullPath.indexOf("TypeScript/tests") < 0 && file != ".git") {
						projectTokens = projectTokens.concat(traverse(fullPath));
					}
					else {
						print("Skipping: " + fullPath);
					}
				}
			}
			catch (err) {
				print("Error processing " + fullPath)
			}
        });
    }
    return projectTokens;
}
function extractAlignedSequences(inputDirectory) {
    const keywords = ["async", "await", "break", "continue", "class", "extends", "constructor", "super", "extends", "const", "let", "var", "debugger", "delete", "do", "while", "export", "import", "for", "each", "in", "of", "function", "return", "get", "set", "if", "else", "instanceof", "typeof", "null", "undefined", "switch", "case", "default", "this", "true", "false", "try", "catch", "finally", "void", "yield", "any", "boolean", "null", "never", "number", "string", "symbol", "undefined", "void", "as", "is", "enum", "type", "interface", "abstract", "implements", "static", "readonly", "private", "protected", "public", "declare", "module", "namespace", "require", "from", "of", "package"];
    let files = [];
	walkSync(inputDirectory, files);
	let program = ts.createProgram(files, { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.CommonJS, checkJs: true, allowJs: true });
    let checker = null;
	try {
		checker = program.getTypeChecker();
    }
	catch (err) {
		return null;
	}
    let fileContents = [[], [], []];
    for (const sourceFile of program.getSourceFiles()) {
        let filename = sourceFile.getSourceFile().fileName;
        if (filename.endsWith('.d.ts')) continue;
        try {
            let relativePath = path.relative(inputDirectory, filename);
            if (relativePath.startsWith("..")) continue;
			let goldPath = filename + ".ttokens.gold"
			if (!fs.existsSync(goldPath)) continue;
            let memS = [];
            let memT = [];
            extractTokens(sourceFile, checker, memS, memT);
			if (memS.length != memT.length) {
                console.log(memS.length + ", " + memT.length);
				continue
			}
			let gold = fs.readFileSync(filename + ".ttokens.gold", "utf-8").split(" ");
			let baseline = fs.readFileSync(filename + ".ttokens", "utf-8").split(" ");
            if (baseline.length != memT.length) {
				print("!? " + baseline.length + ", " + memT.length);
				continue
			}
            // Remove distinct numerals, string, regexes from data, remove any internal white-space from tokens
            for (var ix in memS) {
                if (memS[ix].match("\".*\""))
                    memS[ix] = "\"s\"";
                else if (memS[ix].match("\'.*\'"))
                    memS[ix] = "\'s\'";
                else if (memS[ix].match("/.*/"))
                    memS[ix] = "/r/";
                else if (memS[ix].match("([0-9].*|\.[0-9].*)"))
                    memS[ix] = "0";
                memS[ix] = memS[ix].replace(/\\s/, "");
            }
			// Identify JS files specifically; these should not be used as oracles
			if (filename.endsWith(".js")) {
				memS.unshift("'js'")
				memT.unshift("O")
				gold.unshift("O")
				baseline.unshift("O")
			}
            // Produce content and double-test for inconsistencies
            var content_gold = memS.filter(val => val.length > 0).join(" ") + "\t" + gold.filter(val => val.length > 0).join(" ");
            var content_all = memS.filter(val => val.length > 0).join(" ") + "\t" + baseline.filter(val => val.length > 0).join(" ");
            var content_checkjs = memS.filter(val => val.length > 0).join(" ") + "\t" + memT.filter(val => val.length > 0).join(" ");
            var pretend = content_checkjs.split("\t");
            var left = pretend[0].split(" ");
            var right = pretend[1].split(" ");
            if (left.length != right.length)
                console.log(left.length + ", " + right.length);
            fileContents[0].push(content_gold);
            fileContents[1].push(content_all);
            fileContents[2].push(content_checkjs);
        }
        catch (e) {
            console.log(e);
            console.log("Error parsing file " + filename);
        }
    }
    return fileContents;
}
function extractTokens(tree, checker, memS, memT) {
    var justPopped = false;
    for (var i in tree.getChildren()) {
        var ix = parseInt(i);
        var child = tree.getChildren()[ix];
        if (removableLexicalKinds.indexOf(child.kind) != -1 ||
            ts.SyntaxKind[child.kind].indexOf("JSDoc") != -1) {
            continue;
        }
        if (child.getChildCount() == 0) {
            var source = child.getText();
            var target = "O";
            switch (child.kind) {
                case ts.SyntaxKind.Identifier:
					try {
                        let symbol = checker.getSymbolAtLocation(child);
						if (!symbol) {
							target = "$any$"
							break;
						}
                        let type = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, child));
                        if (checker.isUnknownSymbol(symbol) || type.startsWith("typeof"))
                            target = "$any$";
                        else if (type.startsWith("\""))
                            target = "O";
                        else if (type.match("[0-9]+"))
                            target = "O";
                        else
                            target = '$' + type + '$';
                        break;
                    }
                    catch (e) { }
                    break;
                case ts.SyntaxKind.NumericLiteral:
					source = "0"
                    target = "O";
                    break;
                case ts.SyntaxKind.StringLiteral:
					if (source.startsWith("'")) source = "'s'"
					else source = "\"s\""
                    target = "O";
                    break;
                case ts.SyntaxKind.RegularExpressionLiteral:
					source = "\"/r/\""
                    target = "O";
                    break;
            }
            target = target.trim();
            if (target.match(".+ => .+")) {
                target = "$" + target.substring(target.lastIndexOf(" => ") + 4);
            }
            if (target.match("\\s")) {
                target = "$complex$";
            }
            if (source.length == 0 || target.length == 0) {
                continue;
            }
            if (target != "O") {
                var parentKind = ts.SyntaxKind[tree.kind];
                if (parentKind.toLowerCase().indexOf("template") >= 0)
                    target = "O";
            }
            if (memS.length > 0 && memS[memS.length - 1] == ":" && Boolean(source.match("[a-zA-Z$_][a-zA-Z\$\_\[\]]*"))) {
               var k = tree.kind;
				var t = tree;
				var valid = k == ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration || k == ts.SyntaxKind.Parameter || k == ts.SyntaxKind.VariableDeclaration;
				if (!valid && k == ts.SyntaxKind.TypeReference) {
					k = tree.parent.kind;
					t = tree.parent;
					valid = k == ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration || k == ts.SyntaxKind.Parameter || k == ts.SyntaxKind.VariableDeclaration;
				}
				if (valid) {
					memS.pop();
					memT.pop();
					if (k == ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration) {
						let toFind = t.name.escapedText;
						let index = -1;
						for (let i = memS.length - 1; i >= 0; i--) {
							if (toFind == memS[i] || toFind.substring(1) == memS[i]) {
								index = i;
								break;
							}
						}
						memT[index] = "$" + source + "$"
					}
					else {
						memT[memT.length - 1] = "$" + source + "$";
					}
					justPopped = true;
					continue;
				}
            }
            else if (justPopped) {
                if (source == "[" || source == "]")
                    continue;
                else
                    justPopped = false;
            }
            memS.push(source);
            memT.push(target);
        }
        else {
            extractTokens(child, checker, memS, memT);
        }
    }
}
function walkSync(dir, filelist) {
    var fs = fs || require('fs'), files = fs.readdirSync(dir);
    filelist = filelist || [];
    files.forEach(function (file) {
        let fullPath = path.join(dir, file);
        try {
            if (fs.statSync(fullPath).isDirectory()) {
               if (file != ".git")
					filelist = walkSync(dir + '/' + file, filelist);
            }
            else if (file.endsWith('.js') || file.endsWith('.ts')) {
                if (fs.statSync(fullPath).size < 1*1000*1000)
					filelist.push(fullPath);
            }
        }
        catch (e) {
            console.error("Error processing " + file);
        }
    });
    return filelist;
}
;