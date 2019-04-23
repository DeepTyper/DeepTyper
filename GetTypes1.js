"use strict";
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
var JSONStream = require( "JSONStream" );

var buckets = require('buckets-js');

function print(x) {
    console.log(x);
}

function printn(x) {
    process.stdout.write(x);
}


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

var idx = 0;
var lastToken = -1;
var lastIdentifier = {}

let root = "../Repos_1";
let outputDirPure = "outputs-pure/";
let outputDirTrue = "outputs-true/";
let outputDirCheckJS = "outputs-checkjs/";
try {
    fs.mkdirSync(outputDirTrue);
    fs.mkdirSync(outputDirCheckJS);
}
catch (err) {
}

const ANY_THRESHOLD = 0.2;
var code = "";

fs.readdirSync(root).forEach(org => fs.readdirSync(root + "/" + org).forEach(project => traverseProject(org, project)));

function traverseProject(org, project) {
    // Temporary: these projects fail with stack overflow
    if (org == "DefinitelyTyped" || org == "SAP" || org == "appbaseio" || project == "deepstream.io-client-js"
        || org == "funfix" || org == "improbable-eng" || org == "scikit-rf" || org == "timbertson" || project == "meteor-angular-socially")
        return
    let dir = root + "/" + org + "/" + project;
    //let outFile = dir.substr(root.length + 1) + ".json";
    let outFile = "./graphs/"+project + ".json";
    let projectGraphs = traverse(dir);
    // print(projectGraphs)
    var transformStream = JSONStream.stringify();
    var outputStream = fs.createWriteStream(outFile);
    transformStream.pipe( outputStream );
    projectGraphs.forEach( transformStream.write );
    transformStream.end();

    // fs.writeFile(outFile, projectGraphs, (err) => {
    //     // throws an error, you could also catch it here
    //     if (err) throw err;
    //
    // });
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
    //
    // if (directoryContents.length>0) {
    //     return JSON.stringify(directoryContents);
    // }else{
    //     return ""
    // }
    //
    return directoryContents
    // return String(directoryContents.length)

    //return directoryContents;
}

// interface TypedInterface {
//     fooProperty: string;
// }
//
// interface Bar {
//     barProperty: string;
// }

function isTyped(object) {
    if ('type' in object || 'type?' in object ){
        // print(object.getText())
        // print("^^ is typed")
        return true
    }
    return false
}

// let object: Foo | Bar;
//
// if (isFoo(object)) {
//     // `object` has type `Foo`.
//     object.fooProperty;
// } else {
//     // `object` has type `Bar`.
//     object.barProperty;
// }


//function visit(node, graph, parent) {
// function isParameter(node) {
//     return node ts.isParameterDeclaration
// }



function visit(node, graph, parent) {
    //ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration
    //|| k == ts.SyntaxKind.Parameter || k == ts.SyntaxKind.VariableDeclaration;
    if (idx==null) {
        idx =0;
    }
    var true_idx = idx
    idx+=1

    var children = node.getChildren()
    var children_wnotype = []
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) ||
        ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) ||
        ts.isMappedTypeNode(node) || ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node)) {

        var nflag =false
        for (const child of children) {
            if (ts.isTypeNode(child) || ts.isTypeReferenceNode(child) || ts.isTypeParameterDeclaration(child)){
                // print("---")
                // print("skipping: " + child.getText())
                nflag = true
                // print("----")
               // graph.Typings.push([child.getText(), ts.SyntaxKind[child.kind]])
                if (ts.isTypeNode(child) || ts.isTypeReferenceNode(child) || ts.isTypeParameterDeclaration(child) ) {
                    graph.Typings.push([parent,child.getText()])
                }
            }else {
                children_wnotype.push(child)
            }
        }
        if (nflag) {
            children_wnotype = children_wnotype.filter(child => child.getText() != ":");
        }
    }else{
        children_wnotype = children;
    }



    // if (ts.isTypeNode(node) || ts.isTypeReferenceNode(node) || ts.isTypeParameterDeclaration(node) ) {
    //     graph.Typings.push([true_idx,node.getText()])
    // }
    // print(ts.SyntaxKind[node.kind])
    // print(node.getText())

    // if (ts.SyntaxKind[node.kind]== "SyntaxList") {
    // for (const c of node.getChildren()) {
    //     print(ts.SyntaxKind[c.kind])
    //     print(c.getText())
    // }
    // }



    // for (const child of children) {
    //    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) ||
    //     ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isMappedTypeNode(node)) && isTyped(node)){
    //     continue
    //     }
    //     children_wnotype.push(child)
    // }

    // if ((ts.isVariableDeclaration(node) || ts.isParameter(node) ||
    //     ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isMappedTypeNode(node)) && isTyped(node)){
    //     print(node.getText())
    //     print(node)
    // }

    //  var children = node.getChildren()
    // for (const child of children) {
    //     visit(child, graph, parent);
    // }



    // isTyped(node)
    //Add node information
    // print("START VISIT")
    // print(node.kind)
    // print(ts.SyntaxKind[node.kind])
    // print(graph)
    // print("END VISIT")

    //Parent
    // graph.Nodes[true_idx] = node.kind




    graph.Edges.Parent.push([true_idx,parent])
    parent = true_idx
    var current = true_idx


        //lastLexicalUsed
    if (node.kind === ts.SyntaxKind.Identifier) {
        if (node.getText() in lastIdentifier) {
            graph.Edges.NextLexicalUse.push([lastIdentifier[node.getText()],true_idx]);
        }
        lastIdentifier[node.getText()] = true_idx;
    }

    //NextToken
    if (node.getChildCount()==0) {
        graph.Nodes[true_idx] = node.getText()
        code+=" " + node.getText()
        if (lastToken == -1) {
            lastToken = current;
            graph.Terminals[true_idx] = node.getText();
            // idx+=1;
            return graph
        }
        graph.Terminals[true_idx] = node.getText();
        graph.Edges.NextToken.push([lastToken,current]);
        lastToken = current;
    }else {
        graph.Nodes[true_idx] = ts.SyntaxKind[node.kind]

    }

    //node.forEachChild(visit(node, graph, idx+1));
    // var children = node.getChildren()



    for (const child of children_wnotype) {
        visit(child, graph, parent);
    }
    //
    // print(node.getText())
    // print(ts.SyntaxKind[node.kind])

    return graph

    // ts.forEachChild(node, gr)
    // node.forEachChild(visit);
}

function createGraph(sourceFile, inputDirectory, graph) {
    //all goes in graph function

    var filename = sourceFile.getSourceFile().fileName;


    // const printer = ts.createPrinter({
    //     newLine: ts.NewLineKind.LineFeed
    // });
    //
    // const result = printer.printNode(
    //     ts.EmitHint.Unspecified,
    //     sourceFile
    // );
    //
    // // print(result);

    if (filename.endsWith('.d.ts')) return null



    try {
        let relativePath = path.relative(inputDirectory, filename);
        if (relativePath.startsWith("..")) return null
        // let purePath = filename + ".ttokens.pure"
        // if (!fs.existsSync(purePath)) continue;  // WHAT IS TTOKENS.PURE

        //printLevelOrder(sourceFile)
        graph = visit(sourceFile, graph, null); // THIS ENABLES TRAVERSAL



        //resetting global variables for each graph...
        idx = 0;
        lastToken = -1;
        lastIdentifier = {}

        // if (filename=='/home/krjesse/Repos/1backend/1backend/e2e/utils/utils.ts') {
        //     print(graph);
        // }
        //extractTokens(sourceFile, checker, graph);


        // if (memS.length != memT.length) {
        //     console.log(memS.length + ", " + memT.length);
        //     continue
        // }
        // let pure = fs.readFileSync(filename + ".ttokens.pure", "utf-8").split(" ");
        // let baseline = fs.readFileSync(filename + ".ttokens", "utf-8").split(" ");
        // if (baseline.length != memT.length) {
        //     print("!? " + baseline.length + ", " + memT.length);
        //     continue
        // }
        // // Remove distinct numerals, string, regexes from data, remove any internal white-space from tokens
        // for (var ix in memS) {
        //     if (memS[ix].match("\".*\""))
        //         memS[ix] = "\"s\"";
        //     else if (memS[ix].match("\'.*\'"))
        //         memS[ix] = "\'s\'";
        //     else if (memS[ix].match("/.*/"))
        //         memS[ix] = "/r/";
        //     else if (memS[ix].match("([0-9].*|\.[0-9].*)"))
        //         memS[ix] = "0";
        //     memS[ix] = memS[ix].replace(/\\s/, "");
        // }
        // // Identify JS files specifically; these should not be used as oracles
        // if (filename.endsWith(".js")) {
        //     memS.unshift("'js'")
        //     memT.unshift("O")
        //     pure.unshift("O")
        //     baseline.unshift("O")
        // }
        // // Produce content and double-test for inconsistencies
        // var content_pure = memS.filter(val => val.length > 0).join(" ") + "\t" + pure.filter(val => val.length > 0).join(" ");
        // var content_true = memS.filter(val => val.length > 0).join(" ") + "\t" + baseline.filter(val => val.length > 0).join(" ");
        // var content_checkjs = memS.filter(val => val.length > 0).join(" ") + "\t" + memT.filter(val => val.length > 0).join(" ");
        // var pretend = content_checkjs.split("\t");
        // var left = pretend[0].split(" ");
        // var right = pretend[1].split(" ");
        // if (left.length != right.length)
        //     console.log(left.length + ", " + right.length);
        // fileContents[0].push(content_pure);
        // fileContents[1].push(content_true);
        // fileContents[2].push(content_checkjs);
    }
    catch (e) {
        console.log(e);
        console.log("Error parsing file " + filename);
        return null
    }
    return graph

}

function createGraphs(inputDirectory) {
    const keywords = ["async", "await", "break", "continue", "class", "extends", "constructor", "super", "extends", "const", "let", "var", "debugger", "delete", "do", "while", "export", "import", "for", "each", "in", "of", "function", "return", "get", "set", "if", "else", "instanceof", "typeof", "null", "undefined", "switch", "case", "default", "this", "true", "false", "try", "catch", "finally", "void", "yield", "any", "boolean", "null", "never", "number", "string", "symbol", "undefined", "void", "as", "is", "enum", "type", "interface", "abstract", "implements", "static", "readonly", "private", "protected", "public", "declare", "module", "namespace", "require", "from", "of", "package"];
    let files = [];

    // GET FILES
    walkSync(inputDirectory, files);
    let program = ts.createProgram(files, {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.CommonJS,
        checkJs: true,
        allowJs: true
    });

    let checker = program.getTypeChecker();
    let fileContents = [[], [], []];


    //make function for creating a single graph for each file....





    var graphs = []
    for (const sourceFile of program.getSourceFiles()) {

        //Temporary
        var filename = sourceFile.getSourceFile().fileName;
        if (!filename.includes('utils.ts')) continue

        code = "";
        var graph = {"Edges": {"Parent": [], "NextLexicalUse": [], "NextToken": []}, "Nodes": {}, "Terminals": {}, "Typings":[]};
        idx = 0;

        //The output format should be a JSON formatted file with a list of graphs;
        // you can omit one such file per project. Every graph corresponds to an entire
        // file and contains all the numbered nodes (AST non-terminals and leaf tokens),
        // edges between them (by index, for categories "Parent", "NextToken" and
        // "NextLexicalUse", e.g.: "Edges:{Parent:{[0, 1], [1,2]...}...}") and
        // Types (mapping node index to type name.

        let t = createGraph(sourceFile, inputDirectory, graph)
        if (t != null) {
            t['code'] = code
            graphs.push(t)
        }

        if (graphs.length>0){
            //print(graphs)
            break

        }
    }
    return graphs;
    // return JSON.stringify(graphs);
}

function extractTokens(tree, checker, graph) {
    // var justPopped = false;

    for (var i in tree.getChildren()) {
        var ix = parseInt(i);
        // print(ix)
        var child = tree.getChildren()[ix];
        // print(child)
        // print("Printing Child")
        // // print(child)
        // return
        if (removableLexicalKinds.indexOf(child.kind) != -1 ||
            ts.SyntaxKind[child.kind].indexOf("JSDoc") != -1) {
            continue;
        }
        if (child.getChildCount() == 0) {
            var source = child.getText();
            // var target = "O";
            // switch (child.kind) {
            //     case ts.SyntaxKind.Identifier:
            //         try {
            //             let symbol = checker.getSymbolAtLocation(child);
            //             if (!symbol) {
            //                 target = "$any$"
            //                 break;
            //             }
            //             let type = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, child));
            //             if (checker.isUnknownSymbol(symbol) || type.startsWith("typeof"))
            //                 target = "$any$";
            //             else if (type.startsWith("\""))
            //                 target = "O";
            //             else if (type.match("[0-9]+"))
            //                 target = "O";
            //             else
            //                 target = '$' + type + '$';
            //             break;
            //         }
            //         catch (e) {
            //         }
            //         break;
            //     case ts.SyntaxKind.NumericLiteral:
            //         source = "0"
            //         target = "O";
            //         break;
            //     case ts.SyntaxKind.StringLiteral:
            //         if (source.startsWith("'")) source = "'s'"
            //         else source = "\"s\""
            //         target = "O";
            //         break;
            //     case ts.SyntaxKind.RegularExpressionLiteral:
            //         source = "\"/r/\""
            //         target = "O";
            //         break;
            // }
            // target = target.trim();
            // if (target.match(".+ => .+")) {
            //     target = "$" + target.substring(target.lastIndexOf(" => ") + 4);
            // }
            // if (target.match("\\s")) {
            //     target = "$complex$";
            // }
            // if (source.length == 0 || target.length == 0) {
            //     continue;
            // }
            // if (target != "O") {
            //     var parentKind = ts.SyntaxKind[tree.kind];
            //     if (parentKind.toLowerCase().indexOf("template") >= 0)
            //         target = "O";
            // }
            // if (memS.length > 0 && memS[memS.length - 1] == ":" && Boolean(source.match("[a-zA-Z$_][a-zA-Z\$\_\[\]]*"))) {
            //     var k = tree.kind;
            //     var t = tree;
            //     var valid = k == ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration || k == ts.SyntaxKind.Parameter || k == ts.SyntaxKind.VariableDeclaration;
            //     if (!valid && k == ts.SyntaxKind.TypeReference) {
            //         k = tree.parent.kind;
            //         t = tree.parent;
            //         valid = k == ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration || k == ts.SyntaxKind.Parameter || k == ts.SyntaxKind.VariableDeclaration;
            //     }
            //     if (valid) {
            //         memS.pop();
            //         memT.pop();
            //         if (k == ts.SyntaxKind.FunctionDeclaration || k == ts.SyntaxKind.MethodDeclaration) {
            //             let toFind = t.name.escapedText;
            //             let index = -1;
            //             for (let i = memS.length - 1; i >= 0; i--) {
            //                 if (toFind == memS[i] || toFind.substring(1) == memS[i]) {
            //                     index = i;
            //                     break;
            //                 }
            //             }
            //             memT[index] = "$" + source + "$"
            //         }
            //         else {
            //             memT[memT.length - 1] = "$" + source + "$";
            //         }
            //         justPopped = true;
            //         continue;
            //     }
            // }
            // else if (justPopped) {
            //     if (source == "[" || source == "]")
            //         continue;
            //     else
            //         justPopped = false;
            // }
            // memS.push(source);
            // memT.push(target);
        }
        else {
            for (const param of node.parameters) {
                console.log(param.name.getText());
            }
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
;



// Iterative method to do level order traversal line by line
function printLevelOrder(root)
{
    // Base Case
    if(root == null)
        return;

    // Create an empty queue for level order tarversal
    var q = new buckets.Queue();

    // Enqueue Root and initialize height
    q.add(root);


    while(true)
    {

        // nodeCount (queue size) indicates number of nodes
        // at current level.
        var nodeCount = q.size();
        if(nodeCount == 0)
            break;

        // Dequeue all nodes of current level and Enqueue all
        // nodes of next level
        while(nodeCount > 0)
        {
            var node = q.dequeue();
            if (!node) {
                break
            }
            printn("| $$" + node.getText() +"%%%%%% "+ts.SyntaxKind[node.kind] + "$$ | ");

            // q.dequeue();

            for (const child of node.getChildren()) {
                q.add(child)
            }
            // if(node.left != null)
            //     q.add(node.left);
            // if(node.right != null)
            //     q.add(node.right);
            nodeCount--;
        }
        printn("\n--------------------------------------------------------------\n")
    }
}