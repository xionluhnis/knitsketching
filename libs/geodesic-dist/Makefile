BLD_DIR=build
SRC_DIR=../geometry-central
CMAKE_FLAGS=-DBUILD_SHARED_LIBS=OFF \
						-DBUILD_SHARED_LIBS=OFF \
						-DWITH_THREADLOCAL=OFF \
						-DCMAKE_BUILD_TYPE=RelWithDebInfo
# -DCMAKE_CXX_FLAGS=-g

CPP_BIN=em++
ENV_FLAGS=ONLY_FORCED_STDLIBS=1
PRE_JS=
POST_JS=--post-js gdist.post.js
# JS_SETTINGS=-s "EXTRA_EXPORTED_RUNTIME_METHODS=['ccal', 'cwrap']" -s ERROR_ON_UNDEFINED_SYMBOLS=0
JS_SETTINGS=--bind -s ERROR_ON_UNDEFINED_SYMBOLS=1 \
						-s ASSERTIONS=1 \
						-s DISABLE_EXCEPTION_CATCHING=0 \
						-s ALLOW_MEMORY_GROWTH=1 \
						$(POST_JS)
CPP_FLAGS=-Wall -Wno-unused-label -std=c++17 -O0 \
	-isystem$(BLD_DIR) \
	-isystem$(SRC_DIR) \
	-isystem$(SRC_DIR)/src \
	-isystem$(SRC_DIR)/include \
	-isystem$(BLD_DIR)/deps/eigen-src
LIBDIR=$(BLD_DIR)/src
LIBNAME=libgeometry-central
BASE_FLAGS=$(CPP_FLAGS) $(JS_SETTINGS) -L./$(LIBDIR) -l$(LIBNAME)
SRC=gdist.cpp
OUT=gdist.js

all: gdist

configure:
	(cd $(BLD_DIR) && emcmake cmake ../$(SRC_DIR) $(CMAKE_FLAGS))

$(LIBDIR)/$(LIBNAME).a: configure
	(cd $(BLD_DIR) && emmake make)

gdist/direct: $(LIBDIR)/$(LIBNAME).a
	$(ENV_FLAGS) $(CPP_BIN) $(SRC) -o $(OUT) $(BASE_FLAGS)

gdist/module: $(LIBDIR)/$(LIBNAME).a
	$(ENV_FLAGS) $(CPP_BIN) $(SRC) -o $(OUT) $(BASE_FLAGS) -s MODULARIZE=1

gdist: gdist/module
	

test: $(LIBDIR)/$(LIBNAME).a
	$(ENV_FLAGS) $(CPP_BIN) test.cpp -o run.js $(BASE_FLAGS) -s MODULARIZE=1
	# require('./run.js')().then(r => console.log('Done'))

clean:
	rm -rf $(BLD_DIR)/*

cleanlib:
	rm $(LIBDIR)/$(LIBNAME).a
