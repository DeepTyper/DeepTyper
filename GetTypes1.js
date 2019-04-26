"use strict";
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
var JSONStream = require( "JSONStream" );

var buckets = require('buckets-js');

function print(x) {
	console.log(x);
}

var removableLexicalKinds = [
	ts.SyntaxKind.EndOfFileToken,
	ts.SyntaxKind.NewLineTrivia,
	ts.SyntaxKind.WhitespaceTrivia
];

let root = "D:/Code/type-inference/Repos";
fs.readdirSync(root).forEach(org => fs.readdirSync(root + "/" + org).forEach(project => traverseProject(org, project)));

function traverseProject(org, project) {
	// Temporary: these projects fail with stack overflow
	if (org == "DefinitelyTyped" || org == "SAP" || org == "appbaseio" || project == "deepstream.io-client-js"
		|| org == "funfix" || org == "improbable-eng" || org == "scikit-rf" || org == "timbertson" || project == "meteor-angular-socially")
		return
	let dir = root + "/" + org + "/" + project;
	let outFile = "./graphs/" + org + "__" + project + ".json";
	let projectGraphs = traverse(dir);
	var outputStream = fs.createWriteStream(outFile);
	fs.writeFileSync(outFile, JSON.stringify(projectGraphs), 'utf8');
}

function traverse(dir) {
	var children = fs.readdirSync(dir);
	var directoryContents = []
	if (children.find(value => value == "tsconfig.json")) {
		print("Config in: " + dir);
		// We extract two aligned sequences: the 'true' ones from the initial pass and the tsc+CheckJS derived ones from this pass (without true annotations)
		directoryContents = createGraphs(dir);
	}
	else {
		children.forEach(function (file) {
			let fullPath = dir + "/" + file;
			if (fs.statSync(fullPath).isDirectory()) {
				fullPath.indexOf("DefinitelyTyped")
				if (fullPath.indexOf("DefinitelyTyped") < 0 && fullPath.indexOf("TypeScript/tests") < 0 && file != ".git") {
					directoryContents = directoryContents.concat(traverse(fullPath));
				}
				else {
					print("Skipping: " + fullPath);
				}
			}
		});
	}
	return directoryContents
}

function createGraphs(inputDirectory) {
	let files = [];
	walkSync(inputDirectory, files);
	let program = ts.createProgram(files, {
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.CommonJS,
		checkJs: true,
		allowJs: true
	});
	let checker = program.getTypeChecker();
	var graphs = []
	for (const sourceFile of program.getSourceFiles()) {
		var filename = sourceFile.getSourceFile().fileName;
		if (filename.endsWith('.d.ts') || filename.endsWith('.min.js')) continue;
		let relativePath = path.relative(inputDirectory, filename);
		if (relativePath.startsWith("..")) continue;
		try {
			graphs.push(createGraph(sourceFile, checker))
		} 
		catch (e) {
			console.log("Error parsing file " + filename);
			console.log(e);
		}
	}
	return graphs;
}

// Global variables to track when visiting an AST
var idx, lastToken, lastUse;
function createGraph(sourceFile, checker) {
	// Reset global variables for each graph
	var graph = {"File": sourceFile.getSourceFile().fileName, "Edges": {"Parent": [], "NextLexicalUse": [], "NextToken": []}, "Nodes": {}, "CompilerTypes": {}, "HumanTypes": {}};
	idx = 0;
	lastToken = null;
	lastUse = Object.create(null) // Important: must not use standard {} dict because it conflates fields with keys (e.g. try storing "hasOwnProperty")
	visit(sourceFile, checker, graph, null);
	return graph
}

function visit(node, checker, graph, parent) {
	var curr_idx = idx
	// Get node text (either non-terminal name or leaf text) and skip if empty
	let textVal = node.getChildCount() == 0 ? node.getText() : ts.SyntaxKind[node.kind]
	if (textVal.length == 0) return;
	
	// Otherwise, store it and increment idx
	graph.Nodes[curr_idx] = textVal
	idx += 1
	
	// Add parent edge
	if (parent != null) graph.Edges.Parent.push([curr_idx, parent])
	
	// For identifiers, add last use edge, and any compiler type information
	if (node.kind === ts.SyntaxKind.Identifier) {
		if (textVal in lastUse) {
			graph.Edges.NextLexicalUse.push([lastUse[textVal], curr_idx]);
		}
		lastUse[textVal] = curr_idx;
		
		let symbol = checker.getSymbolAtLocation(node);
		if (symbol) {
			let type = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node));
			if (checker.isUnknownSymbol(symbol) || type.startsWith("typeof") || type.includes(": ")) {
				// Skip; includes in-line structure types and unresolved types. May be revisited
			}
			else {
				if (type.startsWith("\"")) type = "$string$";
				else if (type.match("[0-9\.]+[flLF]?")) type = "$number$";
				else if (type === "true" || type === "false") type = "$boolean$";
				else type = '$' + type + '$';
				graph.CompilerTypes[curr_idx] = type
			}
		}
	}
	
	// Recurse if applicable, but check for optionally typed nodes
	var check_for_types = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertySignature(node) ||
		ts.isPropertyDeclaration(node) || ts.isMappedTypeNode(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
	if (node.getChildCount() > 0) {
		for (const child of node.getChildren()) {
			if (ts.isTypeNode(child) || ts.isTypeReferenceNode(child) || ts.isTypeParameterDeclaration(child)) {
				graph.HumanTypes[curr_idx] = child.getText()
			}
			else {
				visit(child, checker, graph, curr_idx);
			}
		}
	}
	else {
		// Add next-token edge for (non-first) terminals
		if (lastToken != null) {
			graph.Edges.NextToken.push([lastToken, curr_idx]);
		}
		lastToken = curr_idx;
	}
}

// Util function to read a directory recursively with some in-built heuristics. Skips git directory and includes only JS/TS files that are less than one megabyte (to avoid auto-generated code)
function walkSync(dir, filelist) {
	var fs = fs || require('fs'), files = fs.readdirSync(dir);
	filelist = filelist || [];
	files.forEach(function (file) {
		let fullPath = path.join(dir, file);
		try {
			if (fs.statSync(fullPath).isDirectory()) {
				if (file != ".git") filelist = walkSync(dir + '/' + file, filelist);
			}
			else if (file.endsWith('.js') || file.endsWith('.ts')) {
				if (fs.statSync(fullPath).size < 1 * 1000 * 1000)
					filelist.push(fullPath);
			}
		}
		catch (e) {
			console.error("Error processing " + file);
		}
	});
	return filelist;
}