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
let repos = "data/Repos"
let cleaned = "data/Repos-cleaned";

for (let org of fs.readdirSync( repos)) {
	for (let project of fs.readdirSync(repos + "/" + org)) {
		// This project stalls forever
		if (org == "SAP") continue
		let dir = repos + "/" + org + "/" + project;
		traverse(dir);
	}
}

function traverse(dir) {
	var children = fs.readdirSync(dir);
	if (children.find(value => value == "tsconfig.json")) {
		print("Config in: " + dir);
		extractAlignedSequences(dir);
	}
	else {
		children.forEach(function (file) {
			let fullPath = dir + "/" + file;
			try {
				if (fs.statSync(fullPath).isDirectory()) {
					if (fullPath.indexOf("DefinitelyTyped") < 0 && fullPath.indexOf("TypeScript/tests") < 0 && file != ".git") {
						traverse(fullPath);
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
	for (const sourceFile of program.getSourceFiles()) {
		let filename = sourceFile.getSourceFile().fileName;
		if (filename.endsWith('.d.ts'))
			continue;
		try {
			let relativePath = path.relative(inputDirectory, filename);
			if (relativePath.startsWith(".."))
				continue;
			let memS = [];
			let memT = [];
			let memP = [];
			extractTokens(sourceFile, checker, memS, memT, memP);
			if (memS.length != memT.length)
				console.log(memS.length + ", " + memT.length);
			// Write tokens to "Cleaned" repos directory (work in a copy to be safe) and write 'true' types to a separate file there
			fs.writeFileSync(sourceFile.fileName.replace(repos, cleaned), memS.filter(val => val.length > 0).join(" "), 'utf-8');
			fs.writeFileSync(sourceFile.fileName.replace(repos, cleaned) + ".ttokens", memT.filter(val => val.length > 0).join(" "), 'utf-8');
			fs.writeFileSync(sourceFile.fileName.replace(repos, cleaned) + ".ttokens.gold", memP.filter(val => val.length > 0).join(" "), 'utf-8');
		}
		catch (e) {
			console.log(e);
			console.log("Error parsing file " + filename);
		}
	}
}
function extractTokens(tree, checker, memS, memT, memP) {
	var justPopped = false;
	for (var i in tree.getChildren()) {
		var ix = parseInt(i);
		var child = tree.getChildren()[ix];
		if (removableLexicalKinds.indexOf(child.kind) != -1 ||
			ts.SyntaxKind[child.kind].indexOf("JSDoc") != -1) {
			continue;
		}
		// Tentatively remove all templates as these substantially hinder type/token alignment; to be improved in the future
		else if (templateKinds.indexOf(child.kind) != -1) {
			memS.push("`template`");
			memT.push("O");
			memP.push("O");
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
					target = "O";
					break;
				case ts.SyntaxKind.StringLiteral:
					target = "O";
					break;
				case ts.SyntaxKind.RegularExpressionLiteral:
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
			if (memS.length > 0 && memS[memS.length - 1] == ":" && Boolean(source.match("[a-zA-Z$_][0-9a-zA-Z$_\[\]]*"))) {
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
					memP.pop();
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
						memP[index] = "$" + source + "$"
					}
					else {
						memT[memT.length - 1] = "$" + source + "$";
						memP[memP.length - 1] = "$" + source + "$";
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
			memP.push("O");
		}
		else {
			extractTokens(child, checker, memS, memT, memP);
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