from __future__ import print_function # Use a function definition from future version (say 3.x from 2.7 interpreter)
import requests
import os
import sys

import math
import numpy as np
import scipy.sparse
import cntk as C
import pygments

import re
import string
from pygments.lexers import TypeScriptLexer
from pygments.token import Comment, Literal

regex = re.compile(r"^[^\d\W]\w*$", re.UNICODE)
keywords = ["async", "await", "break", "continue", "class", "extends", "constructor", "super", "extends", "const", "let", "var", "debugger", "delete", "do", "while", "export", "import", "for", "each", "in", "of", "function", "return", "get", "set", "if", "else", "instanceof", "typeof", "null", "undefined", "switch", "case", "default", "this", "true", "false", "try", "catch", "finally", "void", "yield", "any", "boolean", "null", "never", "number", "string", "symbol", "undefined", "void", "as", "is", "enum", "type", "interface", "abstract", "implements", "static", "readonly", "private", "protected", "public", "declare", "module", "namespace", "require", "from", "of", "package"]

if len(sys.argv) < 2:
	print("Not enough arguments, pass file name")
	exit(1)
inp = sys.argv[1]
outp = inp[:len(inp) - inp[::-1].index(".")] + "csv"
source_file = "tokens.vocab"
target_file = "types.vocab"
model_file = "model.cntk"

# load dictionaries
source_wl = [line.rstrip('\n') for line in open(source_file)]
target_wl = [line.rstrip('\n') for line in open(target_file)]
source_dict = {source_wl[i]:i for i in range(len(source_wl))}
target_dict = {target_wl[i]:i for i in range(len(target_wl))}

# number of words in vocab, slot labels, and intent labels
vocab_size = len(source_dict)
num_labels = len(target_dict)
epoch_size = 17.955*1000*1000
minibatch_size = 5000
emb_dim = 300
hidden_dim = 650
num_epochs = 10

# Create the containers for input feature (x) and the label (y)
x = C.sequence.input_variable(vocab_size, name="x")
y = C.sequence.input_variable(num_labels, name="y")
t = C.sequence.input_variable(hidden_dim, name="t")

def BiRecurrence(fwd, bwd):
	F = C.layers.Recurrence(fwd)
	G = C.layers.Recurrence(bwd, go_backwards=True)
	x = C.placeholder()
	apply_x = C.splice(F(x), G(x))
	return apply_x

def create_model():
	embed = C.layers.Embedding(emb_dim, name='embed')
	encoder = BiRecurrence(C.layers.GRU(hidden_dim//2), C.layers.GRU(hidden_dim//2))
	recoder = BiRecurrence(C.layers.GRU(hidden_dim//2), C.layers.GRU(hidden_dim//2))
	project = C.layers.Dense(num_labels, name='classify')
	do = C.layers.Dropout(0.5)
	
	def recode(x, t):
		inp = embed(x)
		inp = C.layers.LayerNormalization()(inp)
		
		enc = encoder(inp)
		rec = recoder(enc + t)
		proj = project(do(rec))
		
		dec = C.ops.softmax(proj)
		return enc, dec
	return recode

def criterion(model, labels):
	ce	 = -C.reduce_sum(labels*C.ops.log(model))
	errs = C.classification_error(model, labels)
	return ce, errs

def enhance_data(data, enc):
	guesses = enc.eval({x: data[x]})
	inputs = C.ops.argmax(x).eval({x: data[x]})
	tables = []
	for i in range(len(inputs)):
		ts = []
		table = {}
		counts = {}
		for j in range(len(inputs[i])):
			inp = int(inputs[i][j])
			if inp not in table:
				table[inp] = guesses[i][j]
				counts[inp] = 1
			else:
				table[inp] += guesses[i][j]
				counts[inp] += 1
		for inp in table:
			table[inp] /= counts[inp]
		for j in range(len(inputs[i])):
			inp = int(inputs[i][j])
			ts.append(table[inp])
		tables.append(np.array(np.float32(ts)))
	s = C.io.MinibatchSourceFromData(dict(t=(tables, C.layers.typing.Sequence[C.layers.typing.tensor])))
	mems = s.next_minibatch(minibatch_size)
	data[t] = mems[s.streams['t']]

def create_trainer():
	masked_dec = dec*C.ops.clip(C.ops.argmax(y), 0, 1)
	loss, label_error = criterion(masked_dec, y)
	loss *= C.ops.clip(C.ops.argmax(y), 0, 1)

	lr_schedule = C.learning_parameter_schedule_per_sample([1e-4]*2 + [5e-5]*2 + [1e-6], epoch_size=int(epoch_size))
	momentum_as_time_constant = C.momentum_as_time_constant_schedule(1000)
	learner = C.adam(parameters=dec.parameters,
						 lr=lr_schedule,
						 momentum=momentum_as_time_constant,
						 gradient_clipping_threshold_per_sample=15, 
						 gradient_clipping_with_truncation=True)

	progress_printer = C.logging.ProgressPrinter(tag='Training', num_epochs=num_epochs)
	trainer = C.Trainer(dec, (loss, label_error), learner, progress_printer)
	trainer.restore_from_checkpoint(model_file)
	C.logging.log_number_of_parameters(dec)
	return trainer

def prep(tokens):
	ws = []
	clean = []
	for ttype, value in tokens:
		if value.strip() == '':
			clean.append((ttype, value))
			continue
		# TypeScript lexer fails on arrow token
		if len(ws) > 0 and ws[-1] == "=" and value == ">":
			ws[-1] = "=>"
			t, _ = clean[-1]
			clean[-1] = (t, "=>")
			continue
		elif len(ws) > 1 and ws[-2] == "." and ws[-1] == "." and value == ".":
			ws[-2] = "..."
			ws.pop()
			t, _ = clean[-2]
			clean[-2] = (t, "...")
			del clean[-1]
			continue
		elif len(ws) > 1 and ws[-2] == "`" and value == "`":
			ws[-2] = "`" + ws[-1] + "`"
			ws.pop()
			t, _ = clean[-2]
			_, v = clean[-1]
			clean[-2] = (t, "`" + v + "`")
			del clean[-1]
			continue
		clean.append((ttype, value))
		w = "_UNKNOWN_"
		if value.strip() in source_dict:
			w = value.strip()
		elif ttype in Comment:
			continue
		elif ttype in Literal:
			if ttype in Literal.String:
				if value != '`':
					w = "\"s\""
				else:
					w = '`'
			elif ttype in Literal.Number:
				w = "0"
		ws.append(w)
	return ws, clean

# let's run a sequence through
def run_seq(seq):
	tokens = list(pygments.lex(seq, TypeScriptLexer()))
	ws, tokens = prep(tokens)
	# Set up tensors
	inputs = np.zeros(len(ws))
	outputs = np.zeros(len(ws))
	for i in range(len(ws)):
		inputs[i] = source_dict[ws[i]] if ws[i] in source_dict else source_dict["_UNKNOWN_"]
	N = len(inputs)
	if N > 4*minibatch_size:
		return None
	inputs = scipy.sparse.csr_matrix((np.ones(N, np.float32), (range(N), inputs)), shape=(N, vocab_size))
	outputs = scipy.sparse.csr_matrix((np.ones(N, np.float32), (range(N), outputs)), shape=(N, num_labels))
	sIn = C.io.MinibatchSourceFromData(dict(xx=([inputs], C.layers.typing.Sequence[C.layers.typing.tensor]),
											yy=([outputs], C.layers.typing.Sequence[C.layers.typing.tensor])))
	mb = sIn.next_minibatch(N)
	data = {x: mb[sIn.streams['xx']], y: mb[sIn.streams['yy']]}
	
	enhance_data(data, enc)
	pred = dec.eval({x: data[x], t: data[t]})[0]
	
	with open(outp, 'w', encoding="utf-8") as f:
		ix = 0
		sep = chr(31)
		for tt, v, in tokens:
			f.write("%s%s%s" % (v.replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r"), sep, str(tt)[6:]))
			print(v, end='')
			if v.strip() == '' or tt in Comment:
				f.write('\n')
				continue
			pr = pred[ix]
			ix += 1
			if v.strip() in keywords or not bool(regex.match(v.strip())):
				f.write('\n')
				continue
			r = [i[0] for i in sorted(enumerate(pr), key=lambda x: x[1], reverse=True)]
			guess = target_wl[r[0]]
			gs = [target_wl[r[ix]] for ix in range(5)]
			gs = [g[1:len(g)-1] if g[0]=="$" else g for g in gs]
			if target_wl[r[0]] != "O":
				print(" : %s" % guess[1:len(guess)-1], end='')
			for i in range(len(gs)):
				f.write("%s%s%s%.4f" % (sep, gs[i], sep, pr[r[i]]))
			f.write('\n')
	print()

model = create_model()
enc, dec = model(x, t)
trainer = create_trainer()

with open(inp, 'r', encoding="utf-8") as f:
	content = f.read()
run_seq(content)
